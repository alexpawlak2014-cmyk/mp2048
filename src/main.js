import { MP2048 } from "./game.js";

const canvas = document.querySelector("#game");
const game = new MP2048(canvas);
game.mount();
