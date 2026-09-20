Figma UI Exporter v2

Fixes in this version:
- container wrappers like SECTION / FRAME / GROUP are flattened out
- export now uses the actual visible layers in the selection
- selection bounds are computed from the exported layers, not the container wrapper

Install:
- Put manifest.json, code.js, and ui.html in one folder.
- Load the folder as a Figma plugin.

Use:
- Select the actual UI layers, or select a container that contains them.
- Run the plugin.
- Enter a set name like set1.
- Export.
- Save the downloaded scene.json and manifest.json into exports/set1/.
