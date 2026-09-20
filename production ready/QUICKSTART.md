# Figment Bridge - Quickstart Guide

Connect Figma directly to Blender for instant 1-click 3D UI imports.

---

## 1. Blender Setup (Companion Add-on)

1. Open **Blender** (version 4.0 or newer).
2. Go to **Edit** > **Preferences** > **Add-ons**.
3. In the top-right corner, click the arrow dropdown next to the search bar and choose **Install from Disk...** (or click **Install...**).
4. Navigate to the `Blender Addon` folder and select **`figment_bridge_blender.zip`** (or select `figma_ui_importer_v030.py`).
5. Check the checkbox next to **"Import-Export: Figment Bridge"** to enable it.
6. In the 3D Viewport, press `N` to toggle the sidebar. You will see the **Figment Bridge** tab.

> [!NOTE]
> The add-on runs a local background server on `http://127.0.0.1:8765` automatically. You don't need to configure any network ports.

---

## 2. Figma Setup (Plugin)

### Option A: Manual Install (Immediate Use)
1. Open the **Figma desktop app**.
2. Right-click anywhere on the canvas (or click the Figma logo in the top-left).
3. Go to **Plugins** > **Development** > **Import plugin from manifest...**.
4. Navigate to the `Figma Plugin` folder and select **`manifest.json`**.
5. **Figment Bridge** is now available under your Plugins menu!

### Option B: Publish to Community (For your team / public)
1. In Figma, go to **Plugins** > **Development**.
2. Click the `...` menu next to **Figment Bridge** and choose **Publish...**.
3. Follow Figma's publishing prompts (icon, description, tags).

---

## 3. How to Use (1-Click Direct Transfer)

1. Keep Blender open in the background with Figment Bridge enabled.
2. In Figma, select any Frame, Card, or UI components.
3. Open **Figment Bridge** from your Plugins menu.
4. The status indicator will display **Connected** (green dot).
5. Click **"Transfer to Blender"** (or press `Ctrl + Enter`).
6. Blender instantly receives the geometry, creates the 3D layers, organizes collections, and sets materials!
