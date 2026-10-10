/** 一つの手番の一行（あなたの手・相手の手・決着）。何をして、何が動いたか。 */
export interface TurnLine {
  who: 'you' | 'foe' | 'end';
  what: string;
  effects: string[];
}
