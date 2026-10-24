export const FIELD = {
  width: 800,
  height: 480,
  margin: 17,
  paddleWidth: 14,
  paddleHeight: 92,
  ballRadius: 9,
  leftX: 30,
  rightX: 756,
  maxScore: 7,
  startSpeed: 365,
  maxSpeed: 760,
  speedGain: 1.055,
  reboundAngle: Math.PI * .34,
  countdown: 1.4,
  tick: 1 / 30,
} as const;
export const NETWORK = { snapshotMs: 50, inputMs: 33, maxMessage: 4096 } as const;
