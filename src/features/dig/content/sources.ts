import type { Char, World } from '../core/model';
import { type Patch, setSources, type Trigger } from '../core/rules';
import { type ArchCount, meets, TAG_NAME, type TagCount } from '../core/tags';
import { ARCH_SETS } from './archetypes';
import { DATA_VERSION, PACE, releaseRules } from './balance';
import { BASE_RULES, BASE_TRIGGERS, DEPTH_RULES } from './base';
import { archCount, tagCount } from './cardinfo';
import type { BuildDef, LinkDef, PassiveSpec, TriggerSpec } from './defs';
import { SPILL_AURA } from './epithets';
import { allBuilds, allLinks, cardDef, epithetDef, jobDef, permDef } from './registry';

/**
 * 規則の出どころを集める。遭遇している者（あなたか、ライバル）の
 * カード・エピテット・記憶・職・ビルド・共鳴・原型の重なりと、深さと版。
 */

const archMeets = (have: ArchCount, need: ArchCount | undefined) =>
  !need || Object.entries(need).every(([a, n]) => (have[a as keyof ArchCount] ?? 0) >= (n ?? 0));

/** ビルドの実際の条件（PACE.build 倍）。 */
export const buildNeed = (need: TagCount): TagCount =>
  Object.fromEntries(Object.entries(need).map(([t, n]) => [t, Math.ceil((n ?? 0) * PACE.build)]));

export function buildsOf(c: Char): BuildDef[] {
  const tags = tagCount(c);
  const arch = archCount(c);
  const ids = new Set(c.cards.filter((x) => x).map((x) => x?.id));
  return allBuilds().filter(
    (b) =>
      meets(tags, buildNeed(b.need)) &&
      archMeets(arch, b.arch) &&
      (!b.any || b.any.some((id) => ids.has(id))),
  );
}

export function linksOf(c: Char): LinkDef[] {
  const ids = new Set(c.cards.filter((x) => x).map((x) => x?.id));
  return allLinks().filter((l) => l.cards.every((id) => ids.has(id)));
}

export function archSetsOf(c: Char) {
  const arch = archCount(c);
  return ARCH_SETS.filter((s) => (arch[s.arch] ?? 0) >= s.at);
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
  for (const d of DEPTH_RULES) if (w.depth >= d.at) add(`depth${d.at}`, [d.spec]);
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
  for (const b of buildsOf(c)) add(`build:${b.id}`, b.passive, b.triggers);
  for (const l of linksOf(c)) add(`link:${l.id}`, l.passive, l.triggers);
  for (const s of archSetsOf(c)) add(`arch:${s.arch}${s.at}`, s.passive, s.triggers);
  // 見せ場。合うタグのカードがよく効く（共鳴に数える）。
  for (const t of w.enc?.stage ?? [])
    add(`stage:${t}`, [
      {
        rule: 'mult',
        when: (c) => !!c.tags?.includes(t),
        fn: (_c, v) => v * PACE.stageMult,
        text: `見せ場［${TAG_NAME[t]}］×${PACE.stageMult}`,
      },
    ]);
  // 人物・場所・出来事に刻まれたエピテット。
  for (const e of w.enc?.foe.eps ?? []) {
    const f = epithetDef(e)?.foe;
    if (f?.passive) add(`foe:${e}`, f.passive);
  }
  const node = w.map.find((n) => n.id === w.pos);
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
    w.depth,
    c.cards.map((x) => (x ? `${x.id}+${(x.eps ?? []).join('+')}` : '-')).join(','),
    c.perms.map((p) => `${p}${(c.permEps?.[p] ?? []).join('+')}`).join(','),
    (w.enc?.foe.eps ?? []).join('+'),
    (w.enc?.stage ?? []).join('+'),
    w.pos,
    w.pending?.kind === 'story' ? w.pending.eps.join('+') : '',
  ].join('|');
}

setSources({ key: keyOf, collect });

export const installed = true;
