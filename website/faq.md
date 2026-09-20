# Frequently Asked Questions (FAQ)

Everything you need to know about Figment Bridge.

---

### 1. Do I need to export or download files manually?
No. With Blender open in the background, clicking **Transfer to Blender** sends your selection instantly over a local connection.

### 2. Does it keep text editable and vectors sharp?
Yes. Icons and shapes import as native vector curves, and text imports as native, editable Blender 3D typography.

### 3. How does layer depth work?
It automatically detects your layout hierarchy and stacks backgrounds, cards, buttons, and text along the Z-axis with realistic depth.

### 4. Can I add physical 3D thickness to layers?
Yes. The Blender sidebar includes an **Auto-Solidify** toggle with independent thickness controls for Cards, Text, and SVG icons.

### 5. What versions of Blender are supported?
Blender 4.0 and newer (fully tested on Blender 4.2 LTS and 5.0).

### 6. Are image textures blurry?
No. You can choose texture scales from 1x to 4x in the plugin settings, and textures load with smart filtering enabled.

### 7. Why does the plugin say "Blender Offline"?
Blender must be open with the Figment Bridge add-on enabled. Once active, the status turns green (**Connected**) automatically.

### 8. Is my design data sent to any cloud server?
No. All transfers happen 100% locally on your computer via `localhost`. No data ever leaves your machine.

### 9. Can I still import if I don't use the live bridge?
Yes. The plugin includes a **Save JSON Files** fallback button so you can import scenes from disk anytime in Blender.

### 10. How do I install the Blender add-on?
In Blender, go to **Edit** > **Preferences** > **Add-ons** > **Install from Disk...**, select `figment_bridge_blender.zip`, and enable the checkbox.

### 11. Can I adjust the spacing between 3D layers?
Yes. Adjust the **Layer Distance** slider in the Blender sidebar panel anytime to expand or collapse the 3D depth of your scene.

### 12. Are rounded corners preserved?
Yes. Both uniform and per-corner radii (top-left, top-right, etc.) are converted into smooth Blender curved mesh borders.

### 13. How are auto-layout frames and nested components handled?
Nested frames, components, and auto-layout containers are automatically unrolled and stacked in their correct spatial hierarchy.

### 14. Are strokes and borders supported?
Yes. Borders import as dedicated stroke objects placed cleanly in front of plates to eliminate Z-fighting, with dashed and gradient stroke support.

### 15. Can I toggle shadows for text and icons?
Yes. Use the **Cast Text & Icon Shadows** toggle in the sidebar to let typography cast realistic soft shadows onto cards beneath.

### 16. Can I select only text or only cards in Blender?
Yes. The **Quick Filter Selection** buttons in the panel let you select All, Cards only, or Text only with one click for batch edits.

### 17. Can I re-import an updated layout without losing scene setup?
Yes. Re-transferring replaces the collection geometry cleanly while preserving your custom camera angles, lighting, and world environment.
