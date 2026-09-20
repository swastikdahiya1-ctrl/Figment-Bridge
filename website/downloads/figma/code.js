figma.showUI(__html__, { width: 360, height: 530 });

function getCumulativeOpacity(node) {
  let op = 1.0;
  let curr = node;
  while (curr && curr.type !== "PAGE" && curr.type !== "DOCUMENT") {
    if (typeof curr.opacity === "number") {
      op *= curr.opacity;
    }
    curr = curr.parent;
  }
  return Math.max(0, Math.min(1, op));
}

function solidFill(node) {
  const fills = node.fills;
  if (!Array.isArray(fills)) return null;
  const visibleFills = fills.filter(p => p && p.visible !== false && (p.type === "SOLID" || (p.type && p.type.startsWith("GRADIENT_"))));
  if (!visibleFills.length) return null;
  const h = v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0");

  function getFillColorAndAlpha(f) {
    if (f.type === "SOLID" && f.color) {
      const a = typeof f.opacity === "number" ? f.opacity : 1.0;
      return { r: f.color.r, g: f.color.g, b: f.color.b, a };
    }
    if (f.gradientStops && f.gradientStops.length > 0) {
      let r = 0, g = 0, b = 0, a = 0;
      for (const s of f.gradientStops) {
        r += s.color.r;
        g += s.color.g;
        b += s.color.b;
        a += (typeof s.color.a === "number" ? s.color.a : 1.0);
      }
      const n = f.gradientStops.length;
      const baseA = typeof f.opacity === "number" ? f.opacity : 1.0;
      return { r: r / n, g: g / n, b: b / n, a: (a / n) * baseA };
    }
    return null;
  }

  const parsedFills = visibleFills.map(getFillColorAndAlpha).filter(Boolean);
  if (!parsedFills.length) return null;

  if (parsedFills.length === 1) {
    const f = parsedFills[0];
    return {
      color: `#${h(f.r)}${h(f.g)}${h(f.b)}`,
      opacity: Math.max(0, Math.min(1, f.a))
    };
  }

  // Composite multiple fills from bottom to top
  let r = 0, g = 0, b = 0, a = 0;
  for (const f of parsedFills) {
    const fA = f.a;
    r = f.r * fA + r * (1 - fA);
    g = f.g * fA + g * (1 - fA);
    b = f.b * fA + b * (1 - fA);
    a = fA + a * (1 - fA);
  }
  return {
    color: `#${h(r)}${h(g)}${h(b)}`,
    opacity: Math.max(0, Math.min(1, a))
  };
}

function hasImageFill(node) {
  const fills = node.fills;
  if (!Array.isArray(fills)) return false;
  return !![...fills].reverse().find(p => p && p.visible !== false && p.type === "IMAGE");
}

async function imageFill(node) {
  const fills = node.fills;
  if (!Array.isArray(fills)) return null;
  const fill = [...fills].reverse().find(p => p && p.visible !== false && p.type === "IMAGE");
  if (!fill || !fill.imageHash) return null;
  
  const image = figma.getImageByHash(fill.imageHash);
  if (image) {
    try {
      const bytes = await image.getBytesAsync();
      return { 
        base64: figma.base64Encode(bytes),
        scaleMode: fill.scaleMode,
        imageTransform: fill.imageTransform 
      };
    } catch (e) {
      console.error("Failed to extract image bytes", e);
    }
  }
  return null;
}

function getEffectiveStrokeWeight(node) {
  let sw = node.strokeWeight;
  if (sw === figma.mixed) {
    sw = Math.max(
      node.strokeTopWeight || 0,
      node.strokeBottomWeight || 0,
      node.strokeLeftWeight || 0,
      node.strokeRightWeight || 0
    );
  }
  return (typeof sw === "number" && !isNaN(sw)) ? sw : 0;
}

function solidStroke(node) {
  const strokes = node.strokes;
  if (!Array.isArray(strokes)) return null;
  const stroke = strokes.find(p => p && p.visible !== false && (p.type === "SOLID" || (p.type && p.type.startsWith("GRADIENT_"))));
  if (!stroke) return null;
  const h = v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0");

  let color = stroke.color;
  let opacity = typeof stroke.opacity === "number" ? stroke.opacity : 1.0;

  if (!color && stroke.gradientStops && stroke.gradientStops.length > 0) {
    const s0 = stroke.gradientStops[0];
    color = s0.color;
    if (s0.color && typeof s0.color.a === "number") opacity *= s0.color.a;
  }
  if (!color) return null;

  return {
    color: `#${h(color.r)}${h(color.g)}${h(color.b)}`,
    opacity: Math.max(0, Math.min(1, opacity))
  };
}

function bounds(nodes) {
  const xs = [], ys = [], xe = [], ye = [];
  for (const n of nodes) {
    const b = n.absoluteBoundingBox;
    if (!b) continue;
    xs.push(b.x); ys.push(b.y); xe.push(b.x + b.width); ye.push(b.y + b.height);
  }
  if (!xs.length) return { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.min(...xs), y = Math.min(...ys), ex = Math.max(...xe), ey = Math.max(...ye);
  return { x, y, width: ex - x, height: ey - y };
}

function fontName(fontName) {
  if (!fontName) return null;
  if (typeof fontName === "string") return fontName;
  return { family: fontName.family || "", style: fontName.style || "" };
}

function isContainer(node) {
  return ["FRAME", "GROUP", "SECTION", "COMPONENT", "COMPONENT_SET", "INSTANCE"].includes(node.type);
}

function hasAnyVisibleFill(node) {
  if (hasImageFill(node)) return true;
  const fills = node.fills;
  if (!Array.isArray(fills) || fills.length === 0) return false;
  return fills.some(f => f && f.visible !== false && (typeof f.opacity !== "number" || f.opacity > 0.001));
}

function hasAnyVisibleStroke(node) {
  const strokes = node.strokes;
  if (!Array.isArray(strokes) || strokes.length === 0) return false;
  const sw = getEffectiveStrokeWeight(node);
  if (sw <= 0.001) return false;
  return strokes.some(s => s && s.visible !== false && (typeof s.opacity !== "number" || s.opacity > 0.001));
}

function hasVisualSurface(node) {
  if (solidFill(node) || hasImageFill(node)) return true;
  const stroke = solidStroke(node);
  const sw = getEffectiveStrokeWeight(node);
  if (stroke && sw > 0) return true;
  return false;
}

function hasChildWithImage(node) {
  if (!Array.isArray(node.children)) return false;
  return node.children.some(c => hasImageFill(c) || (isContainer(c) && hasChildWithImage(c)));
}

function isNodeVisuallyRenderable(node) {
  if (node.visible === false) return false;
  if (typeof node.opacity === "number" && node.opacity <= 0.001) return false;
  
  if (node.type === "TEXT") {
    return typeof node.characters === "string" && node.characters.trim().length > 0;
  }
  
  // Containers are evaluated by their children/visual surfaces
  if (isContainer(node)) {
    return true;
  }
  
  // For leaf shapes (VECTOR, RECTANGLE, ELLIPSE, etc.):
  // Only render if it actually has a visible fill or visible stroke
  return hasAnyVisibleFill(node) || hasAnyVisibleStroke(node);
}

function isMaskedContainer(node) {
  return isContainer(node) && Array.isArray(node.children) && node.children.some(c => c.isMask && c.visible !== false);
}

// Collect export nodes and record which containers serve as visible surfaces
function collectExportNodes(selection) {
  const out = [];
  const containerIds = new Set();
  const groupMap = new Map();

  function pushNode(node, currentGroup) {
    if (node.visible === false) return;
    if (typeof node.opacity === "number" && node.opacity <= 0.001) return;
    if (node.isMask) return;

    let group = currentGroup;
    if (node.type === "GROUP" || (node.parent && node.parent.type === "PAGE" && isContainer(node))) {
      group = { id: node.id, name: node.name || "Group" };
    }

    if (isContainer(node) && Array.isArray(node.children) && node.children.length) {
      // If this container has a mask, export the entire container as a single composite unit
      if (isMaskedContainer(node)) {
        if (group) groupMap.set(node.id, group);
        out.push(node);
        return;
      }

      // If a container has a visible fill/stroke, export it as a background plane first
      if (node.type !== "GROUP" && hasVisualSurface(node)) {
        if (group) groupMap.set(node.id, group);
        out.push(node);
        containerIds.add(node.id);
      }
      for (const child of node.children) pushNode(child, group);
      return;
    }

    if (isNodeVisuallyRenderable(node)) {
      if (group) groupMap.set(node.id, group);
      out.push(node);
    }
  }

  for (const node of selection) pushNode(node, null);
  return { exportNodes: out, containerIds, groupMap };
}

async function nodeToJson(node, offX, offY, depth, textMode = "TEXT", textureScale = 2) {
  const isMasked = isMaskedContainer(node);
  const hasImage = !isMasked && (await imageFill(node));
  const isEllipseWithImage = node.type === "ELLIPSE" && hasImage;

  let isSvg = false;
  if (!isMasked && !isEllipseWithImage) {
    isSvg = ["VECTOR", "BOOLEAN_OPERATION", "POLYGON", "STAR", "LINE"].includes(node.type) || (node.type === "ELLIPSE" && !hasImage);
    if (node.type === "TEXT" && (node.fontName === figma.mixed || textMode === "SVG")) {
      isSvg = true;
    }
  }

  let bounds = (isSvg && node.absoluteRenderBounds) ? node.absoluteRenderBounds : node.absoluteBoundingBox;
  if (isMasked) {
    const maskChild = node.children.find(c => c.isMask && c.visible !== false);
    if (maskChild && maskChild.absoluteBoundingBox) {
      bounds = maskChild.absoluteBoundingBox;
    }
  }

  const out = {
    id: node.id,
    name: node.name || node.type,
    type: (isMasked || isEllipseWithImage) ? "RECTANGLE" : node.type,
    x: Math.round((bounds?.x ?? node.x ?? 0) - offX),
    y: Math.round((bounds?.y ?? node.y ?? 0) - offY),
    width: Math.round(bounds?.width ?? node.width ?? 0),
    height: Math.round(bounds?.height ?? node.height ?? 0),
    geom_width: Math.round(node.absoluteBoundingBox?.width ?? node.width ?? 0),
    geom_height: Math.round(node.absoluteBoundingBox?.height ?? node.height ?? 0),
    depth
  };

  const stroke = solidStroke(node);
  const sw = getEffectiveStrokeWeight(node);
  const cumOp = getCumulativeOpacity(node);

  if (stroke && sw > 0) {
    out.strokeWeight = sw;
    out.strokeAlign = node.strokeAlign || "INSIDE";
    out.strokeColor = stroke.color;
    out.strokeOpacity = Number((cumOp * (typeof stroke.opacity === "number" ? stroke.opacity : 1.0)).toFixed(4));
    
    let dashes = node.dashPattern || node.strokeDashes;
    if (dashes && Array.isArray(dashes) && dashes.length > 0) {
      out.strokeDashes = dashes;
    }
  }

  const fill = solidFill(node);
  if (fill) {
    out.fill = fill.color;
    out.opacity = Number((cumOp * fill.opacity).toFixed(4));
  } else {
    out.opacity = Number(cumOp.toFixed(4));
  }
  
  const hasImg = hasImageFill(node);
  const isLeafImage = hasImg && (!isContainer(node) || !node.children || !node.children.length);

  if (isMasked || isEllipseWithImage || isLeafImage) {
    try {
      const bytes = await node.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: textureScale } });
      out.imageBase64 = figma.base64Encode(bytes);
      out.imageScaleMode = "FILL";
      if (isMasked || isEllipseWithImage) {
        out.hasTransparentCrop = true;
      }
    } catch (e) {
      console.error("Failed to export rendered PNG for layer:", e);
      const img = await imageFill(node);
      if (img && img.base64) {
        out.imageBase64 = img.base64;
        out.imageScaleMode = img.scaleMode;
        out.imageTransform = img.imageTransform;
      }
    }
  } else {
    const img = await imageFill(node);
    if (img && img.base64) {
      out.imageBase64 = img.base64;
      out.imageScaleMode = img.scaleMode;
      out.imageTransform = img.imageTransform;
    }
  }
  
  if (isSvg) {
    try {
      const svg = await node.exportAsync({ format: "SVG" });
      out.svg_data = String.fromCharCode.apply(null, svg);
      out.isSvg = true;
    } catch (e) { console.error(e); }
  } else {
    out.isSvg = false;
  }
  
  if (!out.hasTransparentCrop) {
    if (node.type === "ELLIPSE") {
      const r = Math.min(node.width, node.height) / 2;
      out.cornerRadius = [r, r, r, r];
    } else if (node.cornerRadius !== undefined) {
      if (typeof node.cornerRadius === "number") {
        out.cornerRadius = [node.cornerRadius, node.cornerRadius, node.cornerRadius, node.cornerRadius];
      } else {
        out.cornerRadius = [
          node.topLeftRadius || 0,
          node.topRightRadius || 0,
          node.bottomRightRadius || 0,
          node.bottomLeftRadius || 0
        ];
      }
    }
  }

  if (node.type === "TEXT") {
    if (textMode === "SVG") {
      out.type = "SVG";
      out.isSvg = true;
    } else if (textMode === "PNG") {
      try {
        const bytes = await node.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: textureScale } });
        out.imageBase64 = figma.base64Encode(bytes);
        out.imageScaleMode = "FILL";
        out.hasTransparentCrop = true;
        out.type = "RECTANGLE";
        out.fill = null;
      } catch (e) {
        console.error("Failed to export text as PNG:", e);
      }
    } else {
      out.text = node.characters || "";
      out.fontSize = node.fontSize || 16;
      out.fontName = fontName(node.fontName);
      out.textAlignHorizontal = node.textAlignHorizontal || "LEFT";
      out.textAlignVertical = node.textAlignVertical || "TOP";
      out.textAutoResize = node.textAutoResize;
      
      const lh = node.lineHeight;
      if (lh !== figma.mixed && lh && lh.unit) {
        if (lh.unit === "PERCENT") out.lineHeightPercent = lh.value;
        else if (lh.unit === "PIXELS") out.lineHeightPx = lh.value;
      }
      const ls = node.letterSpacing;
      if (ls !== figma.mixed && ls && ls.unit) {
        if (ls.unit === "PERCENT") out.letterSpacingPercent = ls.value;
        else if (ls.unit === "PIXELS") out.letterSpacingPx = ls.value;
      }
    }
  } else if (["VECTOR", "BOOLEAN_OPERATION", "POLYGON", "STAR", "LINE"].includes(node.type)) {
    // We already handled SVG export for these types above if isSvg was true.
    // If they reach here, it's because they are somehow not handled above, but they are.
    // Ellipse with image is explicitly NOT exported as SVG so make_plane handles it perfectly!
  }

  return out;
}

async function buildExport(setName, textMode = "TEXT", textureScale = 2) {
  const selection = figma.currentPage.selection;
  if (!selection.length) throw new Error("Select a frame or some layers first.");

  const { exportNodes, groupMap } = collectExportNodes(selection);
  if (!exportNodes.length) throw new Error("Nothing exportable was found in the selection.");

  let frameBounds = null;
  let clipsContent = false;
  let fx = 0, fy = 0, fw = 0, fh = 0;
  if (selection.length === 1 && ["FRAME", "COMPONENT", "SECTION", "INSTANCE"].includes(selection[0].type)) {
    clipsContent = !!selection[0].clipsContent;
    fx = selection[0].x;
    fy = selection[0].y;
    fw = Math.round(selection[0].width);
    fh = Math.round(selection[0].height);
    frameBounds = { width: fw, height: fh };
  }

  const b = bounds(exportNodes);
  const originX = clipsContent ? fx : b.x;
  const originY = clipsContent ? fy : b.y;

  const canvas = {
    width: clipsContent ? fw : Math.max(1, Math.round(b.width)),
    height: clipsContent ? fh : Math.max(1, Math.round(b.height)),
    frameWidth: fw || Math.max(1, Math.round(b.width)),
    frameHeight: fh || Math.max(1, Math.round(b.height)),
    clipsContent: clipsContent
  };

  function parseZTag(name) {
    if (!name) return 0;
    const match = name.match(/\[z\s*([+-]?\d+)\]/i);
    if (match) {
      const val = parseInt(match[1], 10);
      return isNaN(val) ? 0 : val;
    }
    return 0;
  }

  function boxesOverlap(a, b) {
    const ix1 = Math.max(a.x, b.x);
    const iy1 = Math.max(a.y, b.y);
    const ix2 = Math.min(a.x + a.width, b.x + b.width);
    const iy2 = Math.min(a.y + a.height, b.y + b.height);
    return ix2 > ix1 && iy2 > iy1;
  }

  // Helper: check if a surface plate contains a node
  function surfaceContains(surface, node) {
    if (surface.id === node.id) return false;
    // CRITICAL: A surface can only contain nodes drawn AFTER it in the document
    if (surface.stack_index >= node.stack_index) return false;

    const cx = node.x + node.width / 2;
    const cy = node.y + node.height / 2;
    if (cx >= surface.x - 2 && cx <= surface.x + surface.width + 2 &&
        cy >= surface.y - 2 && cy <= surface.y + surface.height + 2) {
      return true;
    }
    const ix1 = Math.max(surface.x, node.x);
    const iy1 = Math.max(surface.y, node.y);
    const ix2 = Math.min(surface.x + surface.width, node.x + node.width);
    const iy2 = Math.min(surface.y + surface.height, node.y + node.height);
    if (ix2 > ix1 && iy2 > iy1) {
      const interArea = (ix2 - ix1) * (iy2 - iy1);
      const nodeArea = Math.max(1, node.width * node.height);
      if (interArea / nodeArea > 0.5) return true;
    }
    return false;
  }

  // Convert all exportNodes to JSON objects first
  const nodes = [];
  for (let i = 0; i < exportNodes.length; i++) {
    const fn = exportNodes[i];

    // If frame has clipsContent enabled, cull out-of-bounds nodes completely
    if (clipsContent && fw > 0 && fh > 0) {
      const nb = fn.absoluteBoundingBox;
      if (nb) {
        const nx = nb.x - fx;
        const ny = nb.y - fy;
        if (nx + nb.width <= 0 || nx >= fw || ny + nb.height <= 0 || ny >= fh) {
          continue; // completely outside frame
        }
      }
    }

    const nodeData = await nodeToJson(fn, originX, originY, 0, textMode, textureScale);

    // If frame has clipsContent, clamp overlapping rectangular surfaces to frame borders
    if (clipsContent && fw > 0 && fh > 0) {
      if (nodeData.type === "RECTANGLE") {
        if (nodeData.x < 0) {
          nodeData.width = Math.max(1, nodeData.width + nodeData.x);
          nodeData.x = 0;
        }
        if (nodeData.y < 0) {
          nodeData.height = Math.max(1, nodeData.height + nodeData.y);
          nodeData.y = 0;
        }
        if (nodeData.x + nodeData.width > fw) {
          nodeData.width = Math.max(1, fw - nodeData.x);
        }
        if (nodeData.y + nodeData.height > fh) {
          nodeData.height = Math.max(1, fh - nodeData.y);
        }
      }
    }

    nodeData.stack_index = nodes.length;
    const grp = groupMap.get(fn.id);
    if (grp) {
      nodeData.group_id = grp.id;
      nodeData.group_name = grp.name;
    }
    nodes.push(nodeData);
  }

  // Register surface plates (RECTANGLE, FRAME, COMPONENT, INSTANCE, SECTION with area >= 40)
  const SURFACE_TYPES = new Set(['RECTANGLE', 'FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'SECTION']);
  const surfaces = nodes.filter(n => SURFACE_TYPES.has(n.type) && (n.width * n.height >= 40));
  // Sort surfaces in chronological stack order (creation / drawing order)
  surfaces.sort((a, b) => a.stack_index - b.stack_index);

  const surfaceSet = new Set(surfaces.map(s => s.id));

  // Assign depths in chronological stack order
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    
    // Find all earlier surfaces containing this node
    const earlierSurfaces = surfaces.filter(s => s.stack_index < n.stack_index && surfaceContains(s, n));
    
    let baseDepth = 1;
    if (earlierSurfaces.length > 0) {
      // Pick the latest containing surface (top-most in Figma z-order)
      earlierSurfaces.sort((a, b) => b.stack_index - a.stack_index);
      const container = earlierSurfaces[0];
      n.spatial_parent_id = container.id;
      baseDepth = (container.depth || 1) + 1;
    }

    // If this node is a surface plate (like a Card, Popup, or Modal background):
    // It must sit strictly ABOVE any earlier elements that it physically overlaps in 2D space!
    if (surfaceSet.has(n.id)) {
      let maxUnderDepth = 0;
      for (let j = 0; j < i; j++) {
        const earlierNode = nodes[j];
        if (boxesOverlap(n, earlierNode)) {
          if (earlierNode.depth > maxUnderDepth) {
            maxUnderDepth = earlierNode.depth;
          }
        }
      }
      if (maxUnderDepth >= baseDepth) {
        baseDepth = maxUnderDepth + 1;
      }
    }

    const tagOffset = parseZTag(n.name);
    n.depth = Math.max(0, baseDepth + tagOffset);
  }

  return {
    manifest: {
      version: 1,
      set_name: setName,
      scene_file: "scene.json",
      exported_at: new Date().toISOString(),
      source: "figment-bridge",
      texture_scale: textureScale,
      node_count: nodes.length
    },
    scene: {
      version: 1,
      name: setName,
      canvas,
      scale: 0.01,
      nodes
    }
  };
}

figma.ui.onmessage = async (msg) => {
  if (msg.type !== "export") return;
  try {
    const setName = String(msg.setName || "set1").trim().replace(/[\\/:*?"<>|]+/g, "_");
    if (!setName) throw new Error("Enter a set name.");
    const textureScale = [1, 2, 3, 4].includes(Number(msg.textureScale)) ? Number(msg.textureScale) : 2;
    const data = await buildExport(setName, msg.textMode || "TEXT", textureScale);
    if (typeof msg.autoFocus === "boolean") {
      data.scene.auto_focus = msg.autoFocus;
    }

    figma.ui.postMessage({
      type: "export-ready",
      setName,
      action: msg.action || "download",
      sceneJson: JSON.stringify(data.scene, null, 2),
      manifestJson: JSON.stringify(data.manifest, null, 2),
      sceneObj: data.scene,
      manifestObj: data.manifest
    });
  } catch (err) {
    figma.ui.postMessage({
      type: "error",
      message: err && err.message ? err.message : String(err),
    });
  }
};

function sendSelectionInfo() {
  const selection = figma.currentPage.selection;
  if (!selection || selection.length === 0) {
    figma.ui.postMessage({
      type: "selection-changed",
      hasSelection: false,
      name: "",
      width: 0,
      height: 0,
      count: 0
    });
    return;
  }
  const root = selection[0];
  let layerCount = 1;
  if ("findAll" in root) {
    try {
      layerCount = root.findAll().length + 1;
    } catch (e) {
      layerCount = 1;
    }
  } else {
    layerCount = selection.length;
  }
  figma.ui.postMessage({
    type: "selection-changed",
    hasSelection: true,
    name: root.name || "Frame",
    width: Math.round(root.width || 0),
    height: Math.round(root.height || 0),
    count: layerCount
  });
}

figma.on("selectionchange", sendSelectionInfo);
sendSelectionInfo();

