import type { Char, World } from '../core/model';
import { type Patch, setSources, type Trigger } from '../core/rules';
import { type ArchCount, meets, TAG_NAME, type TagCount } from '../core/tags';
import { afterDef } from './after';
import type { ARCH_SETS } from './archetypes';
import { DATA_VERSION, PACE, POINTS, releaseRules } from './balance';
import { BASE_RULES, BASE_TRIGGERS, DEPTH_RULES } from './base';
import { archCount, tagCount } from './cardinfo';
import type { BuildDef, LinkDef, PassiveSpec, TriggerSpec } from './defs';
import { SPILL_AURA } from './epithets';
import { heatOf } from './floors';
import { lawsAt } from './laws';
import { quirkDef } from './quirks';
import { allBuilds, allLinks, cardDef, epithetDef, itemDef, jobDef, permDef } from './registry';
import { titleDef } from './titles';

/**
 * 規則の出どころを集める。遭遇している者（あなたか、ライバル）の
 * カード・エピテット・記憶・職・ビルド・共鳴・原型の重なりと、深さと版。
 */

const archMeets = (have: ArchCount, need: ArchCount | undefined) =>
  !need || Object.entries(need).every(([a, n]) => (have[a as keyof ArchCount] ?? 0) >= (n ?? 0));

/** ビルドの実際の条件（PACE.build 倍）。一度だけ作る。 */
const needs = new WeakMap<TagCount, TagCount>();
const keyed = new WeakMap<TagCount, TagCount>();
/** keystone：ビルドと同じ名の札を持っていると、条件が軽い。 */
export function buildNeed(need: TagCount, keystone = false): TagCount {
  const memo = keystone ? keyed : needs;
  let n = memo.get(need);
  if (!n) {
    const k = PACE.build * (keystone ? PACE.keystone : 1);
    n = Object.fromEntries(Object.entries(need).map(([t, x]) => [t, Math.ceil((x ?? 0) * k)]));
    memo.set(need, n);
  }
  return n;
}

/** 構成の指紋（ビルドの判定を使い回す鍵）。 */
const deckKey = (c: Char) =>
  `${c.cards.map((x) => (x ? `${x.id}+${x.eps.join('+')}` : '-')).join(',')}|${c.perms.map((p) => `${p}${(c.permEps[p] ?? []).join('+')}`).join(',')}`;
const builds = new Map<string, BuildDef[]>();

/**
 * 構成（ビルド）は遊びから外した。札の力はレベルとエピテットで持つ。呼ぶ側のために空を返す
 * （画面と試算の名残を片付けたら、関数ごと消す）。
 */
export function buildsOf(_c: Char): BuildDef[] {
  return [];
}

export function judgedBuilds(c: Char): BuildDef[] {
  const key = deckKey(c);
  const hit = builds.get(key);
  if (hit) return hit;
  const out = judgeBuilds(c);
  if (builds.size > 512) builds.clear();
  builds.set(key, out);
  return out;
}

function judgeBuilds(c: Char): BuildDef[] {
  const tags = tagCount(c);
  const arch = archCount(c);
  const ids = new Set(c.cards.filter((x) => x).map((x) => x?.id));
  return allBuilds().filter(
    (b) =>
      meets(tags, buildNeed(b.need, ids.has(b.id))) &&
      archMeets(arch, b.arch) &&
      (!b.any || b.any.some((id) => ids.has(id))),
  );
}

export function linksOf(_c: Char): LinkDef[] {
  return [];
}

export function judgedLinks(c: Char): LinkDef[] {
  const ids = new Set(c.cards.filter((x) => x).map((x) => x?.id));
  return allLinks().filter((l) => l.cards.every((id) => ids.has(id)));
}

/** 原型の重ねがけも外した（構成と同じ考え方なので）。 */
export function archSetsOf(_c: Char): typeof ARCH_SETS {
  return [];
}

function collect(w: World) {
  const who = w.enc?.who ?? 'you';
  const c = who === 'you' ? w.you : w.rival.char;
  const patches: Patch[] = [];
  const triggers: Trigger[] = [];
  const add = (
    source: string,
    ps: readonly PassiveSpec[] = [],
    ts: readonly TriggerSpec[] = [],
  ) => {
    ps.forEach((p, i) => {
      patches.push({ ...p, id: `${source}#${i}`, source });
    });
    ts.forEach((t, i) => {
      triggers.push({ ...t, id: `${source}#t${i}`, source });
    });
  };
  add('rule', BASE_RULES, BASE_TRIGGERS);
  for (const { v, spec } of releaseRules()) add(`v${v}`, [spec]);
  // 難度の規則は、効きが満ちてから（三区から効きはじめ、五区で満ちる）。
  DEPTH_RULES.forEach((d, i) => {
    if (heatOf(w) >= d.at) add(`depth${i}`, [d.spec]);
  });
  const job = jobDef(c.job);
  if (job) add(`job:${job.id}`, job.passive, job.triggers);
  c.cards.forEach((card, slot) => {
    if (!card) return;
    const def = cardDef(card.id);
    add(`card:${slot}:${def.id}`, def.passive, def.triggers);
    for (const e of card.eps ?? []) {
      const aura = [
        ...(epithetDef(e)?.card?.aura ?? []),
        ...(SPILL_AURA[e] ? [SPILL_AURA[e]] : []),
      ];
      if (aura.length) add(`ep:${slot}:${e}`, aura);
    }
  });
  for (const id of c.perms) {
    const p = permDef(id);
    if (p) add(`perm:${id}`, p.passive, p.triggers);
  }
  // 身につける品。持っているあいだ、ずっと効く。
  for (const it of c.items) {
    const d = itemDef(it.id);
    if (d?.kind === 'keep') add(`keep:${d.id}`, d.passive, d.triggers);
  }
  for (const id of c.titles ?? []) {
    const t = titleDef(id);
    if (t) add(`title:${id}`, t.passive);
  }
  // 決着の余韻（悪名・見透かし…）。あなたの遭遇にだけ効く。
  if ((w.enc?.who ?? 'you') === 'you')
    for (const a of w.after) {
      const d = afterDef(a.kind);
      if (d?.passive) add(`after:${a.kind}`, d.passive);
    }
  // 区画の掟（上の区画の掟も、下では生きている）。共鳴には数えない。
  for (const l of lawsAt(w.stratum)) add(`law:${l.id}`, l.passive);
  // 見せ場。合うタグのカードがよく効く（共鳴に数える）。
  for (const t of w.enc?.stage ?? [])
    add(`stage:${t}`, [
      {
        rule: 'bonus',
        when: (c) => !!c.tags?.includes(t),
        fn: (_c, v) => v + POINTS.stage,
        text: `見せ場［${TAG_NAME[t]}］+${POINTS.stage}`,
      },
    ]);
  // 人物・場所・出来事に刻まれたエピテット。
  for (const e of w.enc?.foe.eps ?? []) {
    const f = epithetDef(e)?.foe;
    if (f?.passive) add(`foe:${e}`, f.passive);
  }
  const node = w.map.find((n) => n.id === w.pos);
  // 階の癖（その階にいるあいだだけ）。
  const q = quirkDef(node?.quirk);
  if (q) add(`quirk:${q.id}`, q.passive);
  for (const e of node?.eps ?? []) {
    const p = epithetDef(e)?.place;
    if (!p) continue;
    const specs: PassiveSpec[] = [];
    if (p.story)
      specs.push({
        rule: 'storyChance',
        fn: (_c, v) => v + (p.story ?? 0),
        text: `場所《${epithetDef(e)?.name}》：出来事 ${p.story > 0 ? '+' : ''}${p.story}%`,
      });
    if (p.heal !== undefined)
      specs.push({
        rule: 'restHeal',
        fn: (_c, v) => Math.round(v * (p.heal ?? 1)),
        text: `場所《${epithetDef(e)?.name}》：回復 ×${p.heal}`,
      });
    if (p.price !== undefined)
      specs.push({
        rule: 'price',
        fn: (_c, v) => Math.round(v * (p.price ?? 1)),
        text: `場所《${epithetDef(e)?.name}》：値段 ×${p.price}`,
      });
    add(`place:${e}`, specs);
  }
  if (w.pending?.kind === 'story') {
    for (const e of w.pending.eps) {
      const st = epithetDef(e)?.story;
      if (st?.chance)
        add(`story:${e}`, [
          {
            rule: 'storyChance',
            fn: (_c, v) => v + (st.chance ?? 0),
            text: `出来事《${epithetDef(e)?.name}》：判定 ${st.chance}%`,
          },
        ]);
    }
  }
  return { patches, triggers };
}

function keyOf(w: World): string {
  const who = w.enc?.who ?? 'you';
  const c = who === 'you' ? w.you : w.rival.char;
  return [
    DATA_VERSION,
    who,
    c.job,
    Math.floor(heatOf(w) * 4),
    c.cards
      .map((x) => (x ? `${x.id}+${(x.eps ?? []).join('+')}+${x.marks.ch ?? 0}` : '-'))
      .join(','),
    (c.titles ?? []).join('+'),
    c.items.map((x) => x.id).join('+'),
    c.perms.map((p) => `${p}${(c.permEps?.[p] ?? []).join('+')}`).join(','),
    (w.enc?.foe.eps ?? []).join('+'),
    w.after.map((a) => a.kind).join('+'),
    (w.enc?.stage ?? []).join('+'),
    w.pos,
    w.pending?.kind === 'story' ? w.pending.eps.join('+') : '',
  ].join('|');
}

setSources({ key: keyOf, collect });

export const installed = true;
