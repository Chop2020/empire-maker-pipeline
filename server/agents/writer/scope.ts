// Scope rules: which source sections make it into the product at all.
import type { Block } from '../../../shared/types.js';

type RecipeBlock = Extract<Block, { type: 'recipe' }>;

const BEEF_CUTS =
  /\b(beef|sirloin|rib[- ]?eye|ribeye|rib steaks?|flank|skirt|chuck|round steak|top round|bottom round|eye of round|tenderloin|filet mignon|fillet mignon|brisket|hanger|flat[- ]iron|t-bone|porterhouse|strip steak|new york strip|cube steaks?|cubed steaks?|tri-tip|london broil|minute steaks?|delmonico|tournedos|chateaubriand|sirloin tip|steak tips?|shoulder steak|blade steak|club steak|kobe|wagyu|corned beef|roast beef|ground round|ground chuck|hamburger|veal)\b/i;
// "<not beef> steak": tuna steak, ham steak, cauliflower steak …
const OTHER_STEAK = /\b(tuna|salmon|halibut|swordfish|shark|cod|mahi|fish|ham|pork|turkey|chicken breast|lamb|venison|elk|bison|calamari|cauliflower|portobello|mushroom|eggplant|tofu|cabbage|celery root)\s+steaks?\b/i;
const OTHER_PROTEIN = /\b(tuna|salmon|halibut|swordfish|shark|cod|mahi|fish|ham|pork|boston butt|turkey|chicken|lamb|venison|elk|bison|calamari|squid|spam|cauliflower|portobello|eggplant|tofu)\b/i;
// "steak sauce", "steak seasoning" are condiments, not steak
const STEAK_CONDIMENT = /\bsteak\s+(sauce|seasoning|spice|rub|salt)\b/i;
// Made for steak: sauces, rubs, marinades, butters, seasonings.
const FOR_STEAK = /\bsteak\b.*\b(sauce|marinade|rub|seasoning|butter|spice|glaze|spray)\b|\b(sauce|marinade|rub|seasoning|butter)\b.*\bfor steaks?\b/i;

export type ScopeVerdict = { keep: boolean; reason: string };

/** Keep beef dishes and things made for steak (sauces, rubs, marinades). Cut fish, pork, ham, poultry, veg "steaks" and sides. */
export function beefScope(r: RecipeBlock): ScopeVerdict {
  const title = r.title;
  const ings = r.ingredients.join(' \n ');
  const beefInIngredients = r.ingredients.some((i) => BEEF_CUTS.test(i) && !OTHER_STEAK.test(i));
  const genericSteak = r.ingredients.some(
    (i) => /\bsteaks?\b/i.test(i) && !STEAK_CONDIMENT.test(i) && !OTHER_STEAK.test(i) && !OTHER_PROTEIN.test(i),
  );
  if (OTHER_STEAK.test(title) && !beefInIngredients) return { keep: false, reason: `Not beef: ${title.match(OTHER_STEAK)![1]}` };
  if (beefInIngredients) return { keep: true, reason: 'Beef' };
  if (genericSteak && !OTHER_STEAK.test(ings)) return { keep: true, reason: 'Steak' };
  if (FOR_STEAK.test(title)) return { keep: true, reason: 'Made for steak (sauce/rub/marinade)' };
  if (OTHER_STEAK.test(ings)) return { keep: false, reason: `Not beef: ${ings.match(OTHER_STEAK)![1]}` };
  return { keep: false, reason: 'No beef in the recipe' };
}
