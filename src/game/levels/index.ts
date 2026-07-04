import { LEVEL_01_GRAVITY_CHAIN } from "./level-01-gravity-chain";
import { LEVEL_02_MANY_BODY_MAZE } from "./level-02-many-body-maze";

export const FIRST_LEVEL = LEVEL_01_GRAVITY_CHAIN;

export const LEVELS = [LEVEL_01_GRAVITY_CHAIN, LEVEL_02_MANY_BODY_MAZE] as const;

export { LEVEL_01_GRAVITY_CHAIN, LEVEL_02_MANY_BODY_MAZE };
