# Face avatar PoC assets

Generated with the built-in **imagegen** tool on 2026-11-16 from the user-approved neutral apron concept. These are static assets, not camera captures. The runtime face is drawn into an in-memory canvas; no face image, frame or landmark is stored here or sent to the server.

| File | Use |
| --- | --- |
| `background.png` | One static kitchen wall; shelf and window at the edges. |
| `body.png` | Transparent, headless / armless neutral apron torso. |
| `sleeve.png` | Transparent capsule, reused for upper arms and forearms. |
| `hand.png` | Transparent mitten, mirrored for the other side. |

Original generated files remain in the ignored `generated_images/` directory. Runtime sprites are copied here unchanged. `AvatarRenderer` finds the alpha bounds once in memory and draws pieces at fixed shoulder / elbow pivots. Existing food emoji and equal feedback are retained.

## Generation prompts

All four calls used the approved neutral-apron concept as a reference and this prefix:

> Create a production-ready 2D game asset matching the provided approved concept: warm cut-paper illustration, subtle paper grain, soft brown outlines, muted sage and oatmeal palette. Not a mockup. No labels, letters, watermarks, faces or UI.

### Background — opaque

> Generate ONLY the kitchen BACKGROUND as a wide landscape 2:1 rectangular illustration. Fill the full image, no rounded frame or page margins. Very pale sage green wall, one small wooden shelf with two bowls and tiny herb plant at the far upper left, one simple small round-topped window with pale blue sky and two clouds at far upper right, narrow pale wooden counter band along bottom 8%. At least the central 70% stays completely empty pale sage for gameplay. No avatar, person, hands, face, food tokens, plates or controls. Match the approved background exactly in spirit; keep decorative objects small, quiet and away from the center.

### Body — transparent

> Generate ONLY the headless, armless avatar TORSO, upright frontal view, isolated on genuine transparent background. One compact boxy short muted olive/sage bib apron over an oatmeal crewneck shirt, two straps with natural wood buttons, darker sage rounded rectangular pocket with small cream sprout emblem and tiny coral fabric tag. Straight horizontal hem with rounded bottom corners, NO scalloped hem, no skirt or dress flare, no cinched waist. Small oatmeal shirt shoulder caps at upper left/right for joining separate arms, simple crewneck opening at top for attaching face circle. No head, no neck sticking out, no arms, no hands, no legs, no shadow beyond object. Torso centered, nearly fills square canvas with modest transparent margin. Full object completely visible, no cropping.

### Sleeve — transparent

> Generate ONE separate ARM SLEEVE SEGMENT only, isolated on genuine transparent background. A simple long rounded oatmeal/cream cloth capsule, vertical upright, approximately width:height 1:2.8. Both ends fully rounded and identical so two copies can overlap at an elbow and rotate naturally. Soft warm brown continuous outline, subtle paper texture and just one very subtle seam stroke. No stripes, no cuff projection, no buttons, no shoulder, no torso, no wrist, no hand, no face, no other elements. Entire capsule visible and centered, 10% transparent margins. This is the reusable upper-arm AND forearm sprite of the approved avatar.

### Hand — transparent

> Generate ONE small cute neutral cream MITTEN HAND sprite only, isolated on genuine transparent background. Round plump palm with a single small rounded thumb bump on its right side; no fingers, no nails, no face, no wrist or sleeve. Warm brown soft outline, very subtle paper texture. Upright fingertip end at top, small rounded base at bottom to overlap a sleeve. Shape should be visually symmetrical enough to mirror for the other hand. Centered and fully visible, modest transparent margin; no other objects.
