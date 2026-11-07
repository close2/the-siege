# Art List: The Siege v2

You generate these images; the pipeline does everything else (background removal, trimming, scaling, WebP).

## 0. Workflow (please read once)

1. **Style lock first.** Generate the 5 **anchor** images in §2. Iterate until you love them. They define the whole look.
2. **Reuse the anchors.** For every later image, **attach the anchors as reference images** and start the prompt with the **style block** (§1). Generating related assets in the same chat also helps.
3. **Sprites go on a flat magenta background (#FF00FF).** No ground, no shadow, no scenery, and the whole object visible with a small margin. If the model adds a floor or shadow, regenerate or say "remove the ground shadow".
   - If magenta bleeds into an object (e.g. pink candy), use **flat green #00FF00** instead and add `_g` to the filename. The script detects it.
4. **Size:** square, at the highest resolution available (≥ 1024 × 1024). The map should be ≥ 2048 × 2048.
5. **Camera:** the same everywhere. **¾ top-down view, about 40° from above,** as in Kingdom Rush or Warcraft III. Units **face right**.
6. **Variants:** for a level 2 or 3 building, attach the level 1 image and say "same building, upgraded: …". For an attack pose, attach the idle image.
7. **Delivery:** save as `art/raw/<id>.png` using the ids below. Done.

> Priority column: **S** = needed for the vertical slice (M3, about 45 images); **L** = later (M7).

## 1. Style block (prefix for every prompt)

```
Hand-painted stylized fantasy game art, in the spirit of Kingdom Rush and Warcraft III:
chunky readable shapes, slightly exaggerated proportions, warm saturated palette
(golden sunlight, rich greens, stone greys, deep blue accents), soft painterly shading
with light coming from the top-left, thin dark-brown outlines, clean silhouette that
reads at small size. Three-quarter top-down view, camera about 40 degrees above.
No text, no letters, no watermark, no UI.
```
Add this for **sprites**: `Single isolated object, centered, fully visible with small margin, on a perfectly flat solid magenta (#FF00FF) background, no ground, no cast shadow, no scenery.`

## 2. Style anchors (do these first)

| id | P | Prompt (after the style block) |
|---|---|---|
| `anchor_map` | S | A small square patch of the valley terrain: green meadow, a winding dirt road, a few trees and rocks. *(Style test for the terrain.)* |
| `anchor_tower` | S | A small wooden archer watchtower on a stone base, with a red-and-gold pennant. *(+ sprite suffix)* |
| `anchor_hero` | S | A heroic knight in blue-and-silver armour with a big round shield and a sword, standing, facing right, sturdy chibi-ish proportions (head about 1/4 of the height). *(+ sprite suffix)* |
| `anchor_enemy` | S | A mischievous gummy-bear monster made of translucent red jelly with angry eyes and tiny fangs, walking, facing right. *(+ sprite suffix)* |
| `anchor_ui` | S | A game UI panel: an ornate dark wooden frame with iron corner brackets and an aged parchment centre, flat front view, perfectly symmetrical, rectangular. *(+ sprite suffix)* |

Once these are approved, they also count as the deliverables `building_archer_1`, `hero_knight`, `enemy_sugar_grunt` and `ui_panel` (copy or rename them).

## 3. Map and Keep

| id | P | Target size in game | Prompt |
|---|---|---|---|
| `map_valley` | S | 2048 × 2048 | Top-down three-quarter view of a lush fantasy valley seen from high above, **square**. In the exact centre an **empty flat grassy hilltop clearing** (about 1/6 of the image, nothing on it). **Four dirt roads** start at the middle of each edge (top, right, bottom, left) and wind towards the central clearing. Along each road, several small **empty flat grassy clearings** next to the road. Around them: meadows, forest clusters, a small river with a wooden bridge crossing one road, rocks, cliffs and darker forest at the map borders. **No buildings, no people, no creatures.** Full painted scene; this is NOT a sprite, so no magenta. |
| `keep_1` | S | ~300 px tall | A small fortified keep: a squat round stone tower with a wooden palisade ring, a gate, a blue banner with a golden hearth-flame emblem, a glowing warm fire at the top. *(sprite)* |
| `keep_2` | L | ~340 px | Same keep, upgraded: stone curtain wall replaces the palisade, a second tower, more banners, the fire brighter. *(sprite, attach keep_1)* |
| `keep_3` | L | ~380 px | Same keep, majestic: a full castle with three towers, golden roof tips, a big glowing crystal hearth on top, banners everywhere. *(sprite, attach keep_2)* |
| `pad_empty` | S | ~120 px wide | A round flat foundation of fitted grey stones set into the grass, slightly overgrown, seen from three-quarter top-down. *(sprite)* |
| `rubble` | S | ~140 px | A pile of broken stones, splintered planks and a torn pennant, smouldering lightly. *(sprite)* |

## 4. Buildings (each level ~160–220 px tall in game)

Generate level 1, then attach it for levels 2 and 3. All buildings stand on a round stone base about the size of `pad_empty`.

| id | P | Prompt |
|---|---|---|
| `building_archer_1` | S | (= anchor_tower) Small wooden archer watchtower on a stone base, red-and-gold pennant. |
| `building_archer_2` | S | Same tower upgraded: taller, the lower half now stone, a roofed lookout platform, two pennants. |
| `building_archer_3` | S | Same tower, masterwork: tall stone tower, blue slate roof, golden trim, a big ballista-crossbow visible on top. |
| `building_mage_1` | S | Small mystic tower of pale stone with a pointed purple roof and a floating glowing blue crystal above it. |
| `building_mage_2` | S | Same, upgraded: taller, rune-carved stone, two orbiting crystals, glowing windows. |
| `building_mage_3` | S | Same, arcane spire: very tall twisted spire, a large radiant crystal, floating stone rings. |
| `building_barracks_1` | S | Small wooden barracks hut with a thatched roof, a weapon rack with spears and a training dummy, a blue banner. |
| `building_barracks_2` | S | Same, upgraded: half-timber and stone walls, tiled roof, shields mounted on the walls, two banners. |
| `building_barracks_3` | S | Same, fortified hall: stone fort with crenellations, a gate, a large heraldic banner, a gleaming knight statue at the entrance. |
| `building_catapult_1` | L | A wooden catapult on a small fortified stone platform, a basket of rocks beside it. |
| `building_catapult_2` | L | Same, upgraded: reinforced with iron bands, a bigger arm, a stone wall around the platform. |
| `building_catapult_3` | L | Same, a massive trebuchet on a fortified stone bastion with golden trim. |

## 5. Heroes and allies (units ~80–110 px tall in game; all face right)

| id | P | Prompt |
|---|---|---|
| `hero_knight` | S | (= anchor_hero) Heroic knight, blue-and-silver armour, round shield, sword, standing. |
| `hero_knight_attack` | S | Same knight mid sword-swing, leaning forward, sword raised. *(attach hero_knight)* |
| `hero_ranger` | S | Heroic ranger in a green hooded cloak with a leather vest and a longbow, standing alert. |
| `hero_ranger_attack` | S | Same ranger drawing the bow at full tension, aiming right. |
| `hero_priest` | S | Heroic priestess in white-and-gold robes with a sun-topped staff that glows softly, kind face. |
| `hero_priest_attack` | S | Same priestess raising her staff, which emits a bright golden glow. |
| `portrait_knight` | S | Bust portrait of the same knight (attach hero_knight), facing the viewer slightly turned, heroic expression. *(sprite)* |
| `portrait_ranger` | S | Bust portrait of the same ranger. *(sprite)* |
| `portrait_priest` | S | Bust portrait of the same priestess. *(sprite)* |
| `soldier_footman` | S | A sturdy footman soldier with a kite shield and a spear, blue tabard, standing ready. Smaller and simpler than the heroes. |
| `soldier_footman_attack` | L | Same footman thrusting the spear forward. |

## 6. Enemies: Sugar Horde (theme `sugar`, face right)

| id | P | Size | Prompt |
|---|---|---|---|
| `enemy_sugar_grunt` | S | ~60 px | (= anchor_enemy) Mischievous red gummy-bear jelly monster, angry eyes, tiny fangs, walking. |
| `enemy_sugar_runner` | S | ~55 px | A small fast imp made of a striped peppermint candy, wrapper flapping like a cape, sprinting with a manic grin. |
| `enemy_sugar_brute` | S | ~110 px | A hulking brute made of solid dark chocolate bars with cracked armour plates, big fists, heavy stomping walk. |
| `enemy_sugar_flyer` | S | ~70 px | A bat-like creature made of fluffy pink-blue cotton candy, wings spread, flying. *(use the green background!)* |
| `enemy_sugar_siege` | S | ~130 px | A lumbering golem built from a stack of layered cream cakes, with a candle on its head and a giant rolling-pin club. |
| `boss_sugar_wraith` | S | ~240 px | The Sugar Wraith: a towering ghostly sorceress of swirling caramel and powdered sugar, glowing pink eyes, a crown of candy shards, trailing a misty sugar cloud, floating menacingly. |
| `boss_sugar_wraith_attack` | L | ~240 px | Same wraith casting: arms thrust forward, a burst of glowing sugar crystals. |
| `portrait_boss_sugar` | S | – | Dramatic bust portrait of the Sugar Wraith, menacing grin. *(sprite)* |

## 7. Projectiles (tiny; ~24–40 px)

| id | P | Prompt |
|---|---|---|
| `proj_arrow` | S | A single wooden arrow with white fletching, horizontal, pointing right, side view. *(sprite)* |
| `proj_rock` | L | A single rough round boulder. *(sprite)* |

The magic bolt, healing glow, sparks, smoke, fire, dust and coins are drawn in code. No art needed.

## 8. UI kit

| id | P | Prompt / spec |
|---|---|---|
| `ui_panel` | S | (= anchor_ui) Ornate dark wooden frame, iron corners, parchment centre, symmetric. *The frame borders must be straight and even so the image can be stretched (9-slice).* |
| `ui_button` | S | A wide rounded game button: polished dark-blue enamel with a thin gold rim, slight bevel, blank (no text), front view, symmetric. *(sprite)* |
| `ui_button_gold` | S | Same button in warm gold and orange, for primary actions. *(sprite)* |
| `ui_banner` | S | A vertical cloth banner hanging from a wooden pole with a swallow-tail bottom, **plain white/light-grey cloth with no emblem** (it gets tinted per player in code). *(sprite)* |
| `ui_ribbon` | L | A horizontal decorative ribbon banner (for titles like "VICTORY"), deep red with gold edges, blank. *(sprite)* |

## 9. Icons (~64–96 px, square, simple, bold, centered)

All of these are sprites: the style block plus the sprite suffix, plus "simple bold game icon".

| id | P | Subject |
|---|---|---|
| `icon_gold` | S | Stack of gold coins |
| `icon_star` | S | Shiny golden star |
| `icon_star_empty` | S | The same star as dull grey stone |
| `icon_heart` | S | Glowing red heart-shaped crystal (Keep HP) |
| `icon_physical` | S | Crossed sword and arrow |
| `icon_magic` | S | Swirling blue magic orb |
| `icon_armor` | S | Steel shield with rivets |
| `icon_flying` | S | Feathered wing |
| `icon_siege` | S | Battering hammer hitting a wall |
| `icon_streak` | S | Burning flame |
| `icon_rally` | S | Golden war horn |
| `icon_repair` | S | Hammer and wrench crossed |
| `icon_check` | L | Green check mark on a wax seal |

## 10. Key art (L)

| id | Prompt |
|---|---|
| `keyart_title` | Wide cinematic painting (16:9): a heroic knight, ranger and priestess on a hill before a glowing keep at dawn, while a horde of candy monsters approaches across the valley; golden sunrise light. Leave the top third calmer for the logo. No text. |
| `keyart_victory` | Square: the three heroes cheering on the keep walls at sunrise, banners flying, confetti-like golden sparks. |
| `keyart_defeat` | Square: the keep smouldering at dusk, the heroes exhausted but standing, determined. Hopeful, not grim. |
| `app_icon` | Square app icon: the glowing hearth-flame keep tower on a deep blue round background, bold and simple, readable at 48 px. Full-bleed, no magenta. |

## Later themes (same role list, after M7)
`sloth` (moss-covered sleepy golems, couch creatures), `doom` (phone-zombies hypnotized by glowing screens, a giant "Doomscroll" worm boss), `ember` (lava imps). Each theme needs the same 6 enemy ids, plus attack poses and a boss portrait: `enemy_<theme>_<role>`, `boss_<theme>`, `portrait_boss_<theme>`.
