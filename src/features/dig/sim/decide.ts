import type { Cmd, Ev } from '../core/events';
import type { World } from '../core/model';
import { Tx } from '../core/tx';
import '../content/sources';
import { basic, useCard } from './encounter';
import { checkGoals, initGoals } from './goals';
import {
  alter,
  announce,
  breathed,
  breather,
  buy,
  choose,
  claim,
  close,
  cure,
  depart,
  inscribe,
  move,
  onward,
  peel,
  rest,
  sacrifice,
  sell,
  start,
  sync,
  tiersOf,
  useItem,
} from './run';

/**
 * コマンド → イベント。世界は読むだけで、書き換えは Tx の emit（畳み込み）に任せる。
 * 断られたコマンドは空の列を返す（記録には残らない）。
 */
export function decide(
  w: World,
  cmd: Cmd,
  opts: {
    sim?: boolean;
    trace?: Map<string, number>;
    why?: { src: string; text: string; at: number }[];
  } = {},
): Ev[] {
  const tx = new Tx(w, opts.sim ?? false);
  const before = opts.sim ? null : tiersOf(w.you);
  tx.trace = opts.trace ?? null;
  tx.why = opts.why ?? null;
  if (w.ending && cmd.c !== 'start') return [];
  let ok = true;
  switch (cmd.c) {
    case 'start':
      start(tx, cmd.seed, cmd.job, cmd.depth, cmd.carry, cmd.remembered, cmd.sheet);
      tx.flush();
      initGoals(tx, cmd.goals);
      break;
    case 'move':
      ok = move(tx, cmd.node);
      break;
    case 'breather':
      // 一服はフロアに一度（締め切りがないぶん、際限なく休めないように）。
      ok = !w.enc && !w.pending && !breathed(w);
      if (ok) breather(tx, cmd.q);
      break;
    case 'item':
      // 持ち物は、向き合っていないときに使う（探る品は、手の空いているときだけ）。
      ok = !w.enc && useItem(tx, cmd.index, cmd.q);
      break;
    case 'act':
      // 素手の手（押す・構える・話す）は無い。立ち去るか、取引に応じるだけ。
      ok = (cmd.a === 'leave' || cmd.a === 'accept') && basic(tx, cmd.a);
      break;
    case 'card':
      ok = useCard(tx, cmd.slot);
      break;
    case 'close':
      ok = close(tx);
      break;
    case 'claim':
      ok = claim(tx, cmd);
      break;
    case 'choose':
      ok = choose(tx, cmd.option);
      break;
    case 'ack':
    case 'depart':
      ok = depart(tx);
      break;
    case 'rest':
      ok = rest(tx, cmd.action, cmd.slot);
      break;
    case 'alter':
      ok = alter(tx, cmd.slot, cmd.to);
      break;
    case 'inscribe':
      ok = inscribe(tx, cmd.ep, cmd);
      break;
    case 'peel':
      ok = peel(tx, cmd.uid, cmd.ep);
      break;
    case 'buy':
      ok = buy(tx, cmd.id, cmd.drop);
      break;
    case 'sell':
      ok = sell(tx, cmd.perm);
      break;
    case 'cure':
      ok = cure(tx, cmd.perm);
      break;
    case 'onward':
      ok = onward(tx, cmd.go);
      break;
    case 'sacrifice':
      ok = sacrifice(tx, cmd.stat, cmd.slot);
      break;
  }
  if (!ok && !tx.out.length) return [];
  tx.flush();
  if (!w.ending) sync(tx);
  // 目標は、試算（予告）には混ぜない。届いた見返りが札の効き目に見えないように。
  if (!opts.sim && !w.ending) checkGoals(tx);
  if (before) announce(tx, before);
  return tx.close();
}
