// The list of effects. To add one: create a file in this folder (copy fire-palm.js as a starting point),
// then import it here and add it to the list. Order here is the order in the picker and the number keys.

import stormCaller from "./storm-caller.js";
import firePalm from "./fire-palm.js";
import starMap from "./star-map.js";
import airDraw from "./air-draw.js";

export const EFFECTS = [stormCaller, firePalm, starMap, airDraw];
