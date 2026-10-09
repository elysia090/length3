import type { Cmd } from '../core/events';

/**
 * 画面の部品が app に頼む窓口。部品は世界（World）を読み、操作は ui.send で送り、
 * 描き直しは ui.render で頼む。app の持つ状態には直接触れない。
 */
export interface Ui {
  send(cmd: Cmd): boolean;
  render(): void;
  /** 案内の帯に一文を出す（台詞・余韻）。 */
  caption(text: string): void;
}
