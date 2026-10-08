import type { Cmd, Ev } from '../core/events';
import type { World } from '../core/model';
import { Tx } from '../core/tx';
import '../content/sources';
import { basic, useCard } from './encounter';
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
  opts: { sim?: boolean; trace?: Map<string, number> } = {},
): Ev[] {
  const tx = new Tx(w, opts.sim ?? false);
  const before = opts.sim ? null : tiersOf(w.you);
  tx.trace = opts.trace ?? null;
  if (w.ending && cmd.c !== 'start') return [];
  let ok = true;
  switch (cmd.c) {
    case 'start':
      start(tx, cmd.seed, cmd.job, cmd.depth, cmd.carry, cmd.remembered, cmd.sheet);
      break;
    case 'move':
      ok = move(tx, cmd.node);
      break;
    case 'breather':
      // 一服はフロアに一度（締め切りがないぶん、際限なく休めないように）。
      ok = !w.enc && !w.pending && !breathed(w);
      if (ok) breather(tx);
      break;
    case 'item':
      ok = !w.pending || w.pending.kind === 'rest' || w.pending.kind === 'encounter';
      if (ok) ok = useItem(tx, cmd.index);
      break;
    case 'act':
      ok = basic(tx, cmd.a);
      break;
    case 'card':
      ok = useCard(tx, cmd.slot);
      break;
    case 'close':
      ok = close(tx);
      break;
    case 'claim':
      ok = claim(tx, cmd.take, cmd.help, cmd.card, cmd.slot);
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
      ok = inscribe(tx, cmd.ep, cmd.slot, cmd.perm);
      break;
    case 'buy':
      ok = buy(tx, cmd.id, cmd.slot);
      break;
    case 'sell':
      ok = sell(tx, cmd.perm);
      break;
    case 'cure':
      ok = cure(tx, cmd.perm);
      break;
    case 'sacrifice':
      ok = sacrifice(tx, cmd.stat, cmd.slot);
      break;
  }
  if (!ok && !tx.out.length) return [];
  tx.flush();
  if (!w.ending) sync(tx);
  if (before) announce(tx, before);
  return tx.close();
}
