bl_info = {
    "name": "Figment Bridge",
    "author": "OpenAI",
    "version": (0, 3, 0),
    "blender": (4, 0, 0),
    "location": "View3D > Sidebar > Figment Bridge",
    "category": "Import-Export",
}

import bpy, json, os, base64, http.server, threading, queue, tempfile, ctypes, re
from bpy.props import StringProperty, EnumProperty, FloatProperty, PointerProperty, BoolProperty
from bpy.types import Operator, Panel, PropertyGroup

SETS = []

def load_json(p):
    with open(p, "r", encoding="utf-8") as f:
        return json.load(f)

def enum_sets(self, context):
    return SETS if SETS else [("NONE", "No sets found", "Press Refresh Sets")]

def scan(root):
    result = []
    if os.path.isdir(root):
        for name in sorted(os.listdir(root)):
            folder = os.path.join(root, name)
            scene = os.path.join(folder, "scene.json")
            if os.path.isdir(folder) and os.path.isfile(scene):
                result.append((name, name, folder))
    return result

def srgb_to_linear(c):
    if c <= 0.04045: return c / 12.92
    return ((c + 0.055) / 1.055) ** 2.4

def rgba(h, a=1.0):
    h = str(h or "#FFFFFF").lstrip("#")
    if len(h) == 3: h = "".join(c*2 for c in h)
    if len(h) == 8:
        hex_alpha = int(h[6:8], 16) / 255.0
        a = float(a) * hex_alpha
        h = h[:6]
    if len(h) != 6: h = "FFFFFF"
    
    linear_rgb = tuple(srgb_to_linear(int(h[i:i+2],16)/255) for i in (0,2,4))
    return linear_rgb + (float(a),)

def color_hex_key(color, hex_hint=None):
    if hex_hint:
        clean = str(hex_hint).lstrip("#").upper()
        if len(clean) == 3: clean = "".join(c*2 for c in clean)
        a = int(round(min(max(color[3] if len(color) > 3 else 1.0, 0.0), 1.0) * 1000))
        return f"{clean}_A{a}"
    r = int(round(min(max(color[0], 0.0), 1.0) * 10000))
    g = int(round(min(max(color[1], 0.0), 1.0) * 10000))
    b = int(round(min(max(color[2], 0.0), 1.0) * 10000))
    a = int(round(min(max(color[3] if len(color) > 3 else 1.0, 0.0), 1.0) * 1000))
    return f"{r:04X}{g:04X}{b:04X}_A{a}"

def mat(name, color, hex_hint=None):
    key = f"FUI_{color_hex_key(color, hex_hint)}"
    m = bpy.data.materials.get(key)
    if not m:
        m = bpy.data.materials.new(key)
        m.diffuse_color = color
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get("Principled BSDF")
        if bsdf:
            bsdf.inputs["Base Color"].default_value = (color[0], color[1], color[2], 1.0)
            bsdf.inputs["Roughness"].default_value = 1.0
            if len(color) > 3 and color[3] < 0.999:
                if "Alpha" in bsdf.inputs:
                    bsdf.inputs["Alpha"].default_value = color[3]
                if hasattr(m, 'blend_method'):
                    try: m.blend_method = 'HASHED'
                    except: m.blend_method = 'BLEND'
                if hasattr(m, 'use_backface_culling'):
                    m.use_backface_culling = True
    return m

def dashed_mat(name, color, dashes, scale):
    dash_val = float(dashes[0] if len(dashes) > 0 else 10)
    gap_val = float(dashes[1] if len(dashes) > 1 else dash_val)
    key = f"FUI_Dash_{color_hex_key(color)}_{int(dash_val)}_{int(gap_val)}"
    m = bpy.data.materials.get(key)
    if not m:
        m = bpy.data.materials.new(key)
        m.diffuse_color = color
        m.use_nodes = True
        if hasattr(m, 'blend_method'):
            m.blend_method = 'CLIP'
        
        nodes = m.node_tree.nodes
        links = m.node_tree.links
        bsdf = nodes.get("Principled BSDF")
        
        if bsdf:
            bsdf.inputs["Base Color"].default_value = color
            bsdf.inputs["Roughness"].default_value = 1.0
            
            # Clear old nodes
            for n in list(nodes):
                if n.type not in ['BSDF_PRINCIPLED', 'OUTPUT_MATERIAL']:
                    nodes.remove(n)
                    
            dash = dash_val * scale
            gap = gap_val * scale
            
            tex_coord = nodes.new("ShaderNodeTexCoord")
            attr = nodes.new("ShaderNodeAttribute")
            attr.attribute_name = "CurveLength"
            
            sep = nodes.new("ShaderNodeSeparateXYZ")
            links.new(tex_coord.outputs["Generated"], sep.inputs[0])
            
            mult = nodes.new("ShaderNodeMath")
            mult.operation = 'MULTIPLY'
            links.new(sep.outputs[0], mult.inputs[0])
            links.new(attr.outputs["Fac"], mult.inputs[1])
            
            mod = nodes.new("ShaderNodeMath")
            mod.operation = 'MODULO'
            mod.inputs[1].default_value = dash + gap
            links.new(mult.outputs[0], mod.inputs[0])
            
            comp = nodes.new("ShaderNodeMath")
            comp.operation = 'LESS_THAN'
            comp.inputs[1].default_value = dash
            links.new(mod.outputs[0], comp.inputs[0])
            
            links.new(comp.outputs[0], bsdf.inputs["Alpha"])
    return m

def image_mat(name, img_path, n=None, use_uv=True):
    img_name = os.path.splitext(os.path.basename(img_path))[0] if img_path else name
    key = f"FUI_Img_{img_name}"
    m = bpy.data.materials.get(key)
    raw_name = os.path.basename(img_path) if img_path else ""
    
    if m:
        if raw_name and raw_name in bpy.data.images:
            try:
                img = bpy.data.images[raw_name]
                img.filepath = img_path
                img.reload()
            except Exception as e:
                pass
        for node_item in m.node_tree.nodes:
            if node_item.type == 'TEX_IMAGE':
                node_item.interpolation = 'Smart'
                if raw_name and raw_name in bpy.data.images:
                    node_item.image = bpy.data.images[raw_name]
        return m

    if not m:
        m = bpy.data.materials.new(key)
        m.use_nodes = True
        
        nodes = m.node_tree.nodes
        links = m.node_tree.links
        bsdf = nodes.get("Principled BSDF")
        
        if bsdf:
            # Clear old nodes
            for node_item in list(nodes):
                if node_item.type not in ['BSDF_PRINCIPLED', 'OUTPUT_MATERIAL']:
                    nodes.remove(node_item)
                    
            tex = nodes.new("ShaderNodeTexImage")
            tex.interpolation = 'Smart'
            try:
                if raw_name and raw_name in bpy.data.images:
                    img = bpy.data.images[raw_name]
                    img.filepath = img_path
                    img.reload()
                else:
                    img = bpy.data.images.load(img_path)
                tex.image = img
            except Exception as e:
                print(f"Failed to load image {img_path}: {e}")
                
            tc = nodes.new("ShaderNodeTexCoord")
            mapping = nodes.new("ShaderNodeMapping")
            
            # Calculate aspect ratio for FILL/FIT
            scale_x, scale_y = 1.0, 1.0
            loc_x, loc_y = 0.0, 0.0
            if n and tex.image:
                if n.get("hasTransparentCrop"):
                    scale_x, scale_y = 1.0, 1.0
                    loc_x, loc_y = 0.0, 0.0
                else:
                    nw = max(float(n.get("width", 1)), 0.0001)
                    nh = max(float(n.get("height", 1)), 0.0001)
                    iw, ih = tex.image.size[0], tex.image.size[1]
                    if iw > 0 and ih > 0:
                        node_aspect = nw / nh
                        img_aspect = iw / ih
                        sm = n.get("imageScaleMode", "FILL")
                        
                        if sm in ["FILL", "CROP"]:
                            if img_aspect > node_aspect:
                                scale_x = node_aspect / img_aspect
                                loc_x = (1.0 - scale_x) / 2.0
                            elif img_aspect < node_aspect:
                                scale_y = img_aspect / node_aspect
                                loc_y = (1.0 - scale_y) / 2.0
                        elif sm == "FIT":
                            if img_aspect > node_aspect:
                                scale_y = img_aspect / node_aspect
                                loc_y = (1.0 - scale_y) / 2.0
                            elif img_aspect < node_aspect:
                                scale_x = node_aspect / img_aspect
                                loc_x = (1.0 - scale_x) / 2.0
                                
            mapping.inputs["Scale"].default_value = (scale_x, scale_y, 1.0)
            mapping.inputs["Location"].default_value = (loc_x, loc_y, 0.0)
            
            if use_uv:
                links.new(tc.outputs["UV"], mapping.inputs["Vector"])
            else:
                links.new(tc.outputs["Generated"], mapping.inputs["Vector"])
                
            links.new(mapping.outputs["Vector"], tex.inputs["Vector"])
            links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
            if "Alpha" in tex.outputs and "Alpha" in bsdf.inputs:
                links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
            
            # Enable Alpha transparency safely across Blender versions
            if hasattr(m, 'blend_method'):
                try: m.blend_method = 'BLEND'
                except: pass
            
            # Adjust roughness so images aren't super shiny
            bsdf.inputs["Roughness"].default_value = 0.8
            
    return m


def delete_collection(name):
    c = bpy.data.collections.get(name)
    if not c: return
    for o in list(c.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.data.collections.remove(c)

def xy(n, cw, ch, scale, centered=True):
    x,y = float(n.get("x",0)), float(n.get("y",0))
    w,h = float(n.get("width",0)), float(n.get("height",0))
    if centered:
        x += w/2; y += h/2
    return ((x-cw/2)*scale, -(y-ch/2)*scale)

def find_font(family, style):
    import os, glob
    dirs = [
        r"C:\Windows\Fonts",
        os.path.join(os.environ.get("LOCALAPPDATA", ""), r"Microsoft\Windows\Fonts")
    ]
    fam = family.replace(" ", "")
    sty = style.replace(" ", "") if style else ""
    
    for d in dirs:
        if not os.path.exists(d): continue
        if sty and sty.lower() != "regular":
            matches = glob.glob(os.path.join(d, f"*{fam}*{sty}*.*tf"))
            if matches: return matches[0]
            
        matches = glob.glob(os.path.join(d, f"*{fam}*.*tf"))
        if matches:
            for m in matches:
                if "Regular" in m or "Normal" in m: return m
            return matches[0]
    return None

def metadata(o, set_name, n, depth):
    o["figma_set"] = set_name
    o["figma_id"] = str(n.get("id", o.name))
    if "spatial_parent_id" in n:
        o["figma_parent_id"] = str(n.get("spatial_parent_id"))
    if "group_id" in n and n.get("group_id"):
        o["figma_group_id"] = str(n.get("group_id"))
    if "group_name" in n and n.get("group_name"):
        o["figma_group_name"] = str(n.get("group_name"))
    o["figma_type"] = str(n.get("type","UNKNOWN"))
    o["figma_depth"] = int(depth)
    o["figma_stack_index"] = int(n.get("stack_index", 0))

def make_plane(n, col, set_name, depth, cw, ch, scale, spacing, folder):
    name = str(n.get("name") or n.get("id") or "Plane")
    has_image = "imageBase64" in n
    has_fill = n.get("fill") is not None
    stroke_weight = float(n.get("strokeWeight", 0))

    # Skip empty containers with no visual surface
    if not has_image and not has_fill and stroke_weight <= 0:
        return

    w = max(float(n.get("width",1))*scale, .001)
    h = max(float(n.get("height",1))*scale, .001)
    cx,cy = xy(n,cw,ch,scale,True)
    mesh = bpy.data.meshes.new(name+"_Mesh")
    radii = n.get("cornerRadius") if not n.get("hasTransparentCrop") else None
    verts = []
    if radii and isinstance(radii, list) and len(radii) == 4 and any(r > 0 for r in radii):
        import math
        tl, tr, br, bl = [r * scale for r in radii]
        segments = 16
        
        # 1. Bottom-Left
        r = min(bl, w/2, h/2)
        if r > 0.0001:
            cx_a, cy_a = -w/2 + r, -h/2 + r
            for i in range(segments + 1):
                a = math.pi + (math.pi/2) * (i / segments)
                verts.append((cx_a + r * math.cos(a), cy_a + r * math.sin(a), 0))
        else:
            verts.append((-w/2, -h/2, 0))
            
        # 2. Bottom-Right
        r = min(br, w/2, h/2)
        if r > 0.0001:
            cx_a, cy_a = w/2 - r, -h/2 + r
            for i in range(segments + 1):
                a = 1.5 * math.pi + (math.pi/2) * (i / segments)
                verts.append((cx_a + r * math.cos(a), cy_a + r * math.sin(a), 0))
        else:
            verts.append((w/2, -h/2, 0))
            
        # 3. Top-Right
        r = min(tr, w/2, h/2)
        if r > 0.0001:
            cx_a, cy_a = w/2 - r, h/2 - r
            for i in range(segments + 1):
                a = 0 + (math.pi/2) * (i / segments)
                verts.append((cx_a + r * math.cos(a), cy_a + r * math.sin(a), 0))
        else:
            verts.append((w/2, h/2, 0))
            
        # 4. Top-Left
        r = min(tl, w/2, h/2)
        if r > 0.0001:
            cx_a, cy_a = -w/2 + r, h/2 - r
            for i in range(segments + 1):
                a = math.pi/2 + (math.pi/2) * (i / segments)
                verts.append((cx_a + r * math.cos(a), cy_a + r * math.sin(a), 0))
        else:
            verts.append((-w/2, h/2, 0))
            
        mesh.from_pydata(verts, [], [tuple(range(len(verts)))])
    else:
        verts = [(-w/2,-h/2,0),(w/2,-h/2,0),(w/2,h/2,0),(-w/2,h/2,0)]
        mesh.from_pydata(verts,[],[(0,1,2,3)])
        
    mesh.update()
    
    # Generate explicit UV map
    uv_layer = mesh.uv_layers.new(name="UVMap")
    for loop in mesh.loops:
        vx = mesh.vertices[loop.vertex_index].co.x
        vy = mesh.vertices[loop.vertex_index].co.y
        # Map from [-w/2, w/2] to [0, 1]
        u = (vx + w/2) / w if w > 0 else 0.5
        v = (vy + h/2) / h if h > 0 else 0.5
        uv_layer.data[loop.index].uv = (u, v)
        
    o = None
    if has_image or has_fill:
        o = bpy.data.objects.new(name, mesh)
        col.objects.link(o)
        o.location = (cx, cy, depth*spacing)
        if has_image:
            img_folder = os.path.join(folder, "images")
            os.makedirs(img_folder, exist_ok=True)
            safe_id = re.sub(r'[^\w\-_\.]', '_', str(n.get("id", name)))
            img_path = os.path.join(img_folder, f"{safe_id}.png")
            try:
                with open(img_path, "wb") as f:
                    f.write(base64.b64decode(n["imageBase64"]))
                mesh.materials.append(image_mat(name, img_path, n=n))
            except Exception as e:
                print(f"Failed to process image: {e}")
                if has_fill:
                    mesh.materials.append(mat(name, rgba(n.get("fill"), n.get("opacity", 1)), hex_hint=n.get("fill")))
                else:
                    mesh.materials.append(mat(name+"_Clear", (0, 0, 0, 0)))
        else:
            mesh.materials.append(mat(name, rgba(n.get("fill"), n.get("opacity", 1)), hex_hint=n.get("fill")))
        metadata(o, set_name, n, depth)
    
    # Generate Stroke if present
    stroke_weight = float(n.get("strokeWeight", 0))
    if stroke_weight > 0:
        stroke_color = n.get("strokeColor", "#000000")
        stroke_opacity = float(n.get("strokeOpacity", 1.0))
        stroke_align = str(n.get("strokeAlign", "INSIDE")).upper()
        dashes = n.get("strokeDashes", [])
        
        if dashes and len(dashes) > 0:
            # Build a 2D Curve so we can use the Spline Parameter for the dashed shader
            curve = bpy.data.curves.new(name+"_StrokeCurve", "CURVE")
            curve.dimensions = '2D'
            spline = curve.splines.new('POLY')
            spline.points.add(len(verts) - 1)
            for i, v in enumerate(verts):
                spline.points[i].co = (v[0], v[1], 0, 1)
            spline.use_cyclic_u = True
            
            # Apply thickness (centered)
            curve.bevel_depth = (stroke_weight * scale) / 2.0
            curve.bevel_resolution = 0
            
            # Calculate perimeter length for the shader
            peri = 0.0
            for i in range(len(verts)):
                p1, p2 = verts[i], verts[(i+1)%len(verts)]
                peri += math.sqrt((p2[0]-p1[0])**2 + (p2[1]-p1[1])**2)
                
            so = bpy.data.objects.new(name+"_Stroke", curve)
            so["CurveLength"] = peri
            so["DashArray"] = dashes
            
            mat_name = name+"_DashedStroke"
            so.data.materials.append(dashed_mat(mat_name, rgba(stroke_color, stroke_opacity), dashes, scale))
            col.objects.link(so)
        else:
            # Build solid wireframe mesh
            stroke_mesh = mesh.copy()
            stroke_mesh.materials.clear()
            stroke_mesh.materials.append(mat(name+"_Stroke", rgba(stroke_color, stroke_opacity), hex_hint=stroke_color))
            
            so = bpy.data.objects.new(name+"_Stroke", stroke_mesh)
            col.objects.link(so)
            
            mod = so.modifiers.new(name="Stroke", type='WIREFRAME')
            mod.thickness = stroke_weight * scale
            mod.use_boundary = True
            mod.use_replace = True
            
            if stroke_align == "INSIDE": mod.offset = -1.0
            elif stroke_align == "OUTSIDE": mod.offset = 1.0
            else: mod.offset = 0.0
            
        so.location = (cx, cy, depth*spacing + 0.0002) # Slightly in-front of fill plane to prevent Z-fighting
        so["figma_is_stroke"] = True
        metadata(so, set_name, n, depth)

def make_text(n, col, set_name, depth, cw, ch, scale, spacing):
    name = str(n.get("name") or n.get("id") or "Text")
    
    align_h = n.get("textAlignHorizontal", "LEFT")
    align_v = n.get("textAlignVertical", "TOP")
    auto_resize = n.get("textAutoResize", "NONE")
    
    x = float(n.get("x", 0))
    y = float(n.get("y", 0))
    w = float(n.get("width", 0))
    h = float(n.get("height", 0))
    
    has_fixed_box = auto_resize in ["HEIGHT", "NONE", "TRUNCATE"] and w > 0
    
    if has_fixed_box:
        anchor_x = x
    else:
        if align_h == "CENTER":
            anchor_x = x + w / 2.0
        elif align_h == "RIGHT":
            anchor_x = x + w
        else:
            anchor_x = x
            
    if align_v == "CENTER":
        anchor_y = y + h / 2.0
    elif align_v == "BOTTOM":
        anchor_y = y + h
    else:
        anchor_y = y
        
    px = (anchor_x - cw / 2.0) * scale
    py = -(anchor_y - ch / 2.0) * scale
    
    curve = bpy.data.curves.new(name + "_Curve", "FONT")
    font_data = n.get("fontName", {})
    family = font_data.get("family", "") if isinstance(font_data, dict) else str(font_data)
    style = font_data.get("style", "") if isinstance(font_data, dict) else ""
    
    if family:
        font_path = find_font(family, style)
        if font_path and os.path.exists(font_path):
            font = None
            for f in bpy.data.fonts:
                if f.filepath == font_path:
                    font = f
                    break
            if not font:
                try: font = bpy.data.fonts.load(font_path)
                except: pass
            if font:
                curve.font = font
            
    curve.body = str(n.get("text", ""))
    
    # Text Alignment
    if align_h == "CENTER": curve.align_x = 'CENTER'
    elif align_h == "RIGHT": curve.align_x = 'RIGHT'
    elif align_h == "JUSTIFIED": curve.align_x = 'JUSTIFY'
    else: curve.align_x = 'LEFT'
    
    if align_v == "CENTER": curve.align_y = 'CENTER'
    elif align_v == "BOTTOM": curve.align_y = 'BOTTOM'
    else: curve.align_y = 'TOP'
    
    # Text Wrapping (Auto Resize)
    if has_fixed_box:
        curve.text_boxes[0].width = w * scale
            
    # Text Line Spacing and Letter Spacing
    if "lineHeightPercent" in n:
        curve.space_line = float(n["lineHeightPercent"]) / 100.0
    elif "lineHeightPx" in n:
        curve.space_line = float(n["lineHeightPx"]) / max(float(n.get("fontSize", 16)), 0.001)
        
    if "letterSpacingPercent" in n:
        curve.space_character = 1.0 + (float(n["letterSpacingPercent"]) / 100.0)
    elif "letterSpacingPx" in n:
        curve.space_character = 1.0 + (float(n["letterSpacingPx"]) / max(float(n.get("fontSize", 16)), 0.001))
            
    # Blender's text size is in arbitrary Blender Units based on 72 DPI points.
    # Figma uses 96 DPI CSS pixels. To match them exactly, we apply a 1.3333x multiplier (96/72).
    base_size = float(n.get("fontSize", 16))
    curve.size = max(base_size * scale * 1.3333, 0.001)
    
    o = bpy.data.objects.new(name, curve)
    col.objects.link(o)
    o.location = (px, py, depth * spacing)
    curve.materials.append(mat(name, rgba(n.get("fill", "#FFFFFF"), n.get("opacity", 1))))
    metadata(o, set_name, n, depth)
    if hasattr(bpy.context.scene, "fui_props"):
        o.visible_shadow = getattr(bpy.context.scene.fui_props, "cast_text_shadows", True)

def calc_curve_length(o):
    length = 0.0
    if not o.data or not hasattr(o.data, 'splines'): return 1.0
    for spline in o.data.splines:
        if spline.type == 'BEZIER':
            pts = spline.bezier_points
            for i in range(len(pts)):
                if not spline.use_cyclic_u and i == len(pts)-1: break
                length += (pts[i].co - pts[(i+1)%len(pts)].co).length
        elif spline.type == 'POLY':
            pts = spline.points
            for i in range(len(pts)):
                if not spline.use_cyclic_u and i == len(pts)-1: break
                length += (pts[i].co.xyz - pts[(i+1)%len(pts)].co.xyz).length
    return length if length > 0.0001 else 1.0

def make_svg(n, col, set_name, depth, cw, ch, scale, spacing, folder):
    name = str(n.get("name") or n.get("id") or "Vector")
    svg_data = n.get("svg_data")
    if not svg_data: return
    
    assets_dir = os.path.join(folder, "assets")
    if not os.path.exists(assets_dir):
        os.makedirs(assets_dir)
        
    clean_id = str(n.get("id", name)).replace(":", "_").replace(";", "_")
    svg_path = os.path.join(assets_dir, f"{clean_id}.svg")
    
    with open(svg_path, "w", encoding="utf-8") as f:
        f.write(svg_data)
        
    existing_objs = set(bpy.data.objects)
    
    if bpy.context.view_layer.objects.active:
        bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.select_all(action='DESELECT')
    
    try:
        bpy.ops.import_curve.svg(filepath=svg_path)
    except Exception as e:
        print(f"Failed to import SVG {svg_path}: {e}")
        return
        
    new_objs = [o for o in bpy.data.objects if o not in existing_objs]
    if not new_objs: return
    
    # Remove any non-curve helper objects (like empties) created by SVG importer
    for o in list(new_objs):
        if o.type != 'CURVE':
            try: bpy.data.objects.remove(o, do_unlink=True)
            except: pass
            
    curve_objs = [o for o in new_objs if o.type == 'CURVE']
    if not curve_objs:
        return
        
    if len(curve_objs) > 1:
        bpy.ops.object.select_all(action='DESELECT')
        for o in curve_objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = curve_objs[0]
        bpy.ops.object.join()
        target_obj = curve_objs[0]
    else:
        target_obj = curve_objs[0]
        
    for c in list(target_obj.users_collection):
        c.objects.unlink(target_obj)
    col.objects.link(target_obj)
    
    for c in list(bpy.data.collections):
        if not c.objects and c.name.endswith(".svg"):
            bpy.data.collections.remove(c)
            
    has_image = False
    img_path = ""
    if "imageBase64" in n:
        img_folder = os.path.join(folder, "images")
        os.makedirs(img_folder, exist_ok=True)
        safe_id = str(n.get("id", name)).replace(":", "_").replace(";", "_").replace("/", "_")
        img_path = os.path.join(img_folder, f"{safe_id}.png")
        try:
            with open(img_path, "wb") as f:
                f.write(base64.b64decode(n["imageBase64"]))
            has_image = True
        except Exception as e:
            print(f"Failed to process image in SVG: {e}")
            
    dashes = n.get("strokeDashes", [])
    if len(target_obj.data.materials) == 0:
        sc = n.get("strokeColor") or n.get("fill") or "#000000"
        so = float(n.get("strokeOpacity") or n.get("opacity") or 1.0)
        if dashes and len(dashes) > 0:
            target_obj["CurveLength"] = calc_curve_length(target_obj)
            target_obj.data.materials.append(dashed_mat(name + "_SVGStroke", rgba(sc, so), dashes, scale))
        elif has_image:
            target_obj.data.materials.append(image_mat(name + "_SVGImage", img_path, n=n, use_uv=False))
        else:
            target_obj.data.materials.append(mat(name + "_SVGStroke", rgba(sc, so)))
            
    for i, m in enumerate(list(target_obj.data.materials)):
        if dashes and len(dashes) > 0:
            target_obj["CurveLength"] = calc_curve_length(target_obj)
            clean_name = m.name.replace("FUI_", "").replace("FUI_Dash_", "")
            target_obj.data.materials[i] = dashed_mat(clean_name, m.diffuse_color, dashes, scale)
        elif has_image:
            target_obj.data.materials[i] = image_mat(name + "_SVGImage", img_path, n=n, use_uv=False)
        else:
            if not m or m.use_nodes: continue
            orig_color = list(m.diffuse_color)
            m.use_nodes = True
            bsdf = m.node_tree.nodes.get("Principled BSDF")
            if not bsdf:
                bsdf = m.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
                out_node = m.node_tree.nodes.get("Material Output")
                if out_node:
                    m.node_tree.links.new(bsdf.outputs[0], out_node.inputs[0])
            if "Base Color" in bsdf.inputs:
                bsdf.inputs["Base Color"].default_value = orig_color
            if "Alpha" in bsdf.inputs:
                bsdf.inputs["Alpha"].default_value = orig_color[3]
            if "Roughness" in bsdf.inputs:
                bsdf.inputs["Roughness"].default_value = 0.8
            if "Specular" in bsdf.inputs:
                bsdf.inputs["Specular"].default_value = 0.1
            if orig_color[3] < 1.0:
                if hasattr(m, 'blend_method'):
                    try: m.blend_method = 'BLEND'
                    except: pass
                if hasattr(m, 'shadow_method'):
                    try: m.shadow_method = 'NONE'
                    except: pass
            bsdf.inputs["Roughness"].default_value = 1.0

    sw = float(n.get("strokeWeight", 0))
    svg_data = n.get("svg_data", "")
    has_stroke = "stroke" in svg_data.lower()
    needs_stroke = (sw > 0) or has_stroke
    
    target_obj.location = (0, 0, 0)
    target_obj.scale = (1.0, 1.0, 1.0)
    if target_obj.data and hasattr(target_obj.data, 'bevel_depth'):
        if needs_stroke:
            target_obj.data.bevel_depth = 0
            target_obj.data.extrude = 0.1
        if target_obj.data.bevel_depth > 0:
            target_obj.data.bevel_resolution = 4
            target_obj.data.use_fill_caps = False
            
    if target_obj.data and hasattr(target_obj.data, 'splines'):
        for spline in target_obj.data.splines:
            for bp in getattr(spline, 'bezier_points', []):
                bp.co.z = 0
                bp.handle_left.z = 0
                bp.handle_right.z = 0
            for p in getattr(spline, 'points', []):
                p.co.z = 0

    bpy.context.view_layer.update()
    min_x = min_y = float('inf')
    max_x = max_y = float('-inf')
    has_bounds = False
    
    depsgraph = bpy.context.evaluated_depsgraph_get()
    eval_obj = target_obj.evaluated_get(depsgraph)
    try:
        mesh = eval_obj.to_mesh()
        if mesh:
            for v in mesh.vertices:
                min_x = min(min_x, v.co.x)
                max_x = max(max_x, v.co.x)
                min_y = min(min_y, v.co.y)
                max_y = max(max_y, v.co.y)
                has_bounds = True
            eval_obj.to_mesh_clear()
    except:
        pass
        
    if not has_bounds and target_obj.data and hasattr(target_obj.data, 'splines'):
        for spline in target_obj.data.splines:
            for bp in getattr(spline, 'bezier_points', []):
                min_x = min(min_x, bp.co.x)
                max_x = max(max_x, bp.co.x)
                min_y = min(min_y, bp.co.y)
                max_y = max(max_y, bp.co.y)
                has_bounds = True
            for p in getattr(spline, 'points', []):
                min_x = min(min_x, p.co.x)
                max_x = max(max_x, p.co.x)
                min_y = min(min_y, p.co.y)
                max_y = max(max_y, p.co.y)
                has_bounds = True
                
    px, py = xy(n, cw, ch, scale, centered=False)
    
    if has_bounds:
        imp_w = max_x - min_x
        imp_h = max_y - min_y
        
        target_w = float(n.get("width", 1)) * scale
        target_h = float(n.get("height", 1)) * scale
        
        if max(imp_w, imp_h) > 0.0001:
            if imp_w > imp_h:
                s = target_w / imp_w
            else:
                s = target_h / imp_h
        else:
            s = scale
            
        for spline in target_obj.data.splines:
            for bp in getattr(spline, 'bezier_points', []):
                bp.co.x -= min_x
                bp.co.y -= max_y
                bp.handle_left.x -= min_x
                bp.handle_left.y -= max_y
                bp.handle_right.x -= min_x
                bp.handle_right.y -= max_y
            for p in getattr(spline, 'points', []):
                p.co.x -= min_x
                p.co.y -= max_y
                
        if needs_stroke and target_obj.data and hasattr(target_obj.data, 'bevel_depth'):
            effective_sw = sw if sw > 0 else 1.0
            target_obj.data.extrude = 0
            if s > 0:
                target_obj.data.bevel_depth = max((effective_sw * scale / 2.0) / s, 0.0001)
            else:
                target_obj.data.bevel_depth = 0.0001
                
        target_obj.scale = (s, s, 1.0)
    else:
        target_obj.scale = (scale, scale, 1.0)
        
    target_obj.location = (px, py, depth * spacing)
    target_obj.name = name
    if needs_stroke:
        target_obj["figma_is_stroke"] = True
    metadata(target_obj, set_name, n, depth)
    if hasattr(bpy.context.scene, "fui_props"):
        target_obj.visible_shadow = getattr(bpy.context.scene.fui_props, "cast_text_shadows", True)


def update_depth(context):
    spacing = context.scene.fui_props.layer_distance
    
    # Map figma_id to object to resolve parent chains quickly
    id_to_obj = {}
    for o in bpy.data.objects:
        if "figma_id" in o:
            id_to_obj[o["figma_id"]] = o
            
    for o in bpy.data.objects:
        if "figma_depth" in o:
            # Accumulate spatial offsets up the tree
            inherited_offset = 0.0
            curr = o
            while curr:
                inherited_offset += getattr(curr, "fui_local_offset", 0.0)
                pid = curr.get("figma_parent_id")
                curr = id_to_obj.get(pid) if pid else None
                
            stack_idx = int(o.get("figma_stack_index", 0))
            is_stroke = bool(o.get("figma_is_stroke", False)) or o.name.endswith("_Stroke")
            stroke_bias = 0.0002 if is_stroke else 0.0
            o.location.z = (int(o["figma_depth"]) * spacing) + inherited_offset + (stack_idx * 0.00005) + stroke_bias

def is_text_or_icon(o):
    if o.type == 'CURVE':
        return True
    ftype = str(o.get("figma_type", "")).upper()
    if ftype in ["TEXT", "VECTOR", "BOOLEAN_OPERATION", "STAR", "POLYGON", "LINE", "SVG"]:
        return True
    if o.name.endswith("_Stroke") or o.name.endswith("_Curve") or "_Vector" in o.name:
        return True
    return False

def apply_text_shadows(enable: bool):
    count = 0
    for o in bpy.data.objects:
        if "figma_id" in o or "figma_set" in o or o.name.startswith("FIGMA_"):
            if is_text_or_icon(o):
                o.visible_shadow = enable
                count += 1
    return count

def text_shadows_changed(self, context):
    apply_text_shadows(self.cast_text_shadows)

def object_offset_changed(self, context):
    update_depth(context)

def spacing_changed(self,context):
    update_depth(context)

def get_layer_category(o):
    # Returns 'TEXT', 'SVG', or 'CARDS'
    ftype = str(o.get("figma_type", "")).upper()
    if ftype == "TEXT" or o.type == 'FONT' or "_Text" in o.name or o.get("figma_text_mode"):
        return 'TEXT'
    if ftype in ["VECTOR", "BOOLEAN_OPERATION", "STAR", "POLYGON", "LINE", "SVG"] or o.name.endswith("_Curve") or "_Vector" in o.name or (o.type == 'CURVE' and not o.name.endswith("_Stroke")):
        return 'SVG'
    if o.name.endswith("_Stroke"):
        return 'SVG'
    return 'CARDS'

def apply_solidify_to_objects(context, target_category=None):
    p = context.scene.fui_props
    target = target_category or p.solidify_target
    
    th_global = p.solidify_thickness_global
    th_cards = p.solidify_thickness_cards
    th_svg = p.solidify_thickness_svg
    th_text = p.solidify_thickness_text
    
    figma_objs = [o for o in bpy.data.objects if ("figma_id" in o or "figma_set" in o or o.name.startswith("FIGMA_")) and o.type in {'MESH', 'CURVE', 'FONT'}]
    if not figma_objs:
        figma_objs = [o for o in bpy.data.objects if o.type in {'MESH', 'CURVE', 'FONT'}]

    count = 0
    for o in figma_objs:
        if o.name.endswith("_Stroke") or o.get("figma_is_stroke"):
            continue
            
        cat = get_layer_category(o)
        
        # Check if this object is included in the target category
        if target != 'GLOBAL' and cat != target:
            continue
            
        # Determine specific thickness
        if target == 'GLOBAL':
            thickness = th_global
        elif cat == 'CARDS':
            thickness = th_cards
        elif cat == 'SVG':
            thickness = th_svg
        elif cat == 'TEXT':
            thickness = th_text
        else:
            thickness = th_global
            
        if o.type == 'MESH':
            mod = o.modifiers.get("FUI_Solidify")
            if not mod:
                mod = o.modifiers.new("FUI_Solidify", 'SOLIDIFY')
            mod.thickness = max(thickness, 0.0001)
            mod.offset = -1.0
            mod.use_rim = True
            mod.use_rim_only = False
            count += 1
        elif o.type in {'CURVE', 'FONT'}:
            if hasattr(o.data, 'extrude'):
                o.data.extrude = max(thickness / 2.0, 0.00005)
                count += 1
                
    return count

def remove_solidify_from_objects(context, target_category=None):
    p = context.scene.fui_props
    target = target_category or p.solidify_target
    
    figma_objs = [o for o in bpy.data.objects if ("figma_id" in o or "figma_set" in o or o.name.startswith("FIGMA_")) and o.type in {'MESH', 'CURVE', 'FONT'}]
    if not figma_objs:
        figma_objs = [o for o in bpy.data.objects if o.type in {'MESH', 'CURVE', 'FONT'}]
        
    count = 0
    for o in figma_objs:
        cat = get_layer_category(o)
        if target != 'GLOBAL' and cat != target:
            continue
            
        if o.type == 'MESH':
            mod = o.modifiers.get("FUI_Solidify")
            if mod:
                o.modifiers.remove(mod)
                count += 1
        elif o.type in {'CURVE', 'FONT'}:
            if hasattr(o.data, 'extrude'):
                o.data.extrude = 0.0
                count += 1
                
    return count

def update_solidify_live(self, context):
    apply_solidify_to_objects(context)

def filter_select_objects(context, category):
    bpy.ops.object.select_all(action='DESELECT')
    figma_objs = [o for o in bpy.data.objects if ("figma_id" in o or "figma_set" in o or o.name.startswith("FIGMA_")) and o.type in {'MESH', 'CURVE', 'FONT'}]
    if not figma_objs:
        figma_objs = [o for o in bpy.data.objects if o.type in {'MESH', 'CURVE', 'FONT'}]
    count = 0
    first_obj = None
    for o in figma_objs:
        cat = get_layer_category(o)
        if category == 'ALL' or cat == category:
            o.select_set(True)
            if not first_obj:
                first_obj = o
            count += 1
    if first_obj:
        context.view_layer.objects.active = first_obj
    return count

def get_ui_center_and_span():
    import mathutils
    figma_objs = [o for o in bpy.data.objects if ("figma_id" in o or "figma_set" in o or o.name.startswith("FIGMA_")) and o.type in {'MESH', 'CURVE', 'FONT'}]
    if not figma_objs:
        figma_objs = [o for o in bpy.data.objects if o.type in {'MESH', 'CURVE', 'FONT'}]
    if not figma_objs:
        return (0.0, 0.0, 0.0), 5.0

    min_x = min_y = min_z = float('inf')
    max_x = max_y = max_z = float('-inf')
    for o in figma_objs:
        for corner in o.bound_box:
            world_co = o.matrix_world @ mathutils.Vector(corner)
            min_x = min(min_x, world_co.x)
            max_x = max(max_x, world_co.x)
            min_y = min(min_y, world_co.y)
            max_y = max(max_y, world_co.y)
            min_z = min(min_z, world_co.z)
            max_z = max(max_z, world_co.z)

    cx = (min_x + max_x) / 2.0
    cy = (min_y + max_y) / 2.0
    cz = (min_z + max_z) / 2.0
    span = max(max_x - min_x, max_y - min_y, 1.0)
    return (cx, cy, cz), span


class Props(PropertyGroup):
    export_root:StringProperty(name="Export Folder",subtype="DIR_PATH")
    selected_set:EnumProperty(name="Available Set",items=enum_sets)
    layer_distance:FloatProperty(name="Layer Distance",default=.05,min=0,soft_max=1,step=0.5,precision=4,update=spacing_changed)
    cast_text_shadows:BoolProperty(
        name="Cast Text & Icon Shadows",
        description="Toggle shadow casting for text and vector icons (cards/backgrounds remain unaffected)",
        default=True,
        update=text_shadows_changed
    )
    auto_solidify:BoolProperty(
        name="Auto-Solidify on Import",
        description="Automatically give 3D physical depth/thickness to imported Figma layers",
        default=True
    )
    solidify_target:EnumProperty(
        name="Solidify Target",
        description="Target category for thickness adjustments",
        items=[
            ('GLOBAL', "All Layers (Global)", "Apply thickness to all imported layers"),
            ('CARDS', "Cards / BG Elements", "Apply thickness only to cards, frames, rectangles, and backgrounds"),
            ('SVG', "SVG / Icons", "Apply thickness only to vector shapes and SVG icons"),
            ('TEXT', "Text Layers", "Apply thickness only to typography and text elements")
        ],
        default='GLOBAL',
        update=update_solidify_live
    )
    solidify_thickness_global:FloatProperty(
        name="Global Thickness",
        description="3D thickness applied to all layers",
        default=0.005,
        min=0.0001,
        max=0.5,
        step=0.1,
        precision=4,
        unit='LENGTH',
        update=update_solidify_live
    )
    solidify_thickness_cards:FloatProperty(
        name="Cards Thickness",
        description="3D thickness for cards, rectangles, and background plates",
        default=0.008,
        min=0.0001,
        max=0.5,
        step=0.1,
        precision=4,
        unit='LENGTH',
        update=update_solidify_live
    )
    solidify_thickness_svg:FloatProperty(
        name="SVG/Icons Thickness",
        description="3D thickness for vector curves and SVG icons",
        default=0.003,
        min=0.0001,
        max=0.5,
        step=0.1,
        precision=4,
        unit='LENGTH',
        update=update_solidify_live
    )
    solidify_thickness_text:FloatProperty(
        name="Text Thickness",
        description="3D thickness for typography and text",
        default=0.004,
        min=0.0001,
        max=0.5,
        step=0.1,
        precision=4,
        unit='LENGTH',
        update=update_solidify_live
    )


class Refresh(Operator):
    bl_idname="fui.refresh"; bl_label="Refresh Sets"
    def execute(self,context):
        global SETS
        SETS=scan(bpy.path.abspath(context.scene.fui_props.export_root))
        if SETS: context.scene.fui_props.selected_set=SETS[0][0]
        self.report({"INFO"},f"Found {len(SETS)} set(s)")
        return {"FINISHED"}

def import_scene_data(data, folder, context):
    p = context.scene.fui_props
    set_name = str(data.get("name", "set1"))
    canvas = data.get("canvas", {})
    cw = float(canvas.get("width", 1920))
    ch = float(canvas.get("height", 1080))
    scale = float(data.get("scale", .01))
    cname = "FIGMA_" + set_name
    delete_collection(cname)
    col = bpy.data.collections.new(cname)
    bpy.context.scene.collection.children.link(col)
    nodes = data.get("nodes", [])
    for i, n in enumerate(nodes):
        if n.get("visible") is False:
            continue
        op = n.get("opacity")
        if op is not None and float(op) <= 0.001:
            continue
        depth = int(n.get("depth", 0))
        if n.get("svg_data"):
            make_svg(n, col, set_name, depth, cw, ch, scale, p.layer_distance, folder)
        elif str(n.get("type", "")).upper() == "TEXT":
            make_text(n, col, set_name, depth, cw, ch, scale, p.layer_distance)
        else:
            make_plane(n, col, set_name, depth, cw, ch, scale, p.layer_distance, folder)
    root = bpy.data.objects.new(cname + "_ROOT", None)
    root.empty_display_type = 'PLAIN_AXES'
    root.empty_display_size = 0.1
    col.objects.link(root)
    
    # Group hierarchy: group objects by figma_group_id
    groups = {}
    group_names = {}
    ungrouped = []
    
    for o in list(col.objects):
        if o == root:
            continue
        gid = o.get("figma_group_id")
        if gid:
            if gid not in groups:
                groups[gid] = []
                group_names[gid] = o.get("figma_group_name") or f"Group_{gid}"
            groups[gid].append(o)
        else:
            ungrouped.append(o)
            
    bpy.context.view_layer.update()
    for gid, children in groups.items():
        gname = group_names[gid]
        grp_obj = bpy.data.objects.new(gname, None)
        grp_obj.empty_display_type = 'PLAIN_AXES'
        grp_obj.empty_display_size = 0.05
        col.objects.link(grp_obj)
        
        if children:
            gx = sum(c.location.x for c in children) / len(children)
            gy = sum(c.location.y for c in children) / len(children)
            grp_obj.location = (gx, gy, 0.0)
            
        grp_obj.parent = root
        grp_obj.matrix_parent_inverse = root.matrix_world.inverted()
        
        bpy.context.view_layer.update()
        for c in children:
            c.parent = grp_obj
            c.matrix_parent_inverse = grp_obj.matrix_world.inverted()
            
    for o in ungrouped:
        if not o.parent:
            o.parent = root
            o.matrix_parent_inverse = root.matrix_world.inverted()
        
    # Clean up any wasted empties with no children that SVG importer might have left behind
    for o in list(col.objects):
        if o.type == 'EMPTY' and len(o.children) == 0 and o != root:
            bpy.data.objects.remove(o, do_unlink=True)
            
    # Clean up any leftover clip box objects from older imports
    old_box = bpy.data.objects.get(f"FIGMA_{set_name}_CLIPBOX")
    if old_box:
        bpy.data.objects.remove(old_box, do_unlink=True)
            
    update_depth(context)
    if p.auto_solidify:
        apply_solidify_to_objects(context)
    apply_text_shadows(p.cast_text_shadows)
    return set_name

def focus_blender_window():
    try:
        import ctypes
        import ctypes.wintypes
        
        user32 = ctypes.windll.user32
        kernel32 = ctypes.windll.kernel32
        my_pid = os.getpid()
        target_hwnd = None
        
        WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.wintypes.BOOL, ctypes.wintypes.HWND, ctypes.wintypes.LPARAM)
        user32.EnumWindows.argtypes = [WNDENUMPROC, ctypes.wintypes.LPARAM]
        user32.EnumWindows.restype = ctypes.wintypes.BOOL
        
        def enum_windows_proc(hwnd, lparam):
            nonlocal target_hwnd
            if user32.IsWindowVisible(hwnd):
                pid = ctypes.wintypes.DWORD()
                user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
                if pid.value == my_pid:
                    class_buf = ctypes.create_unicode_buffer(256)
                    user32.GetClassNameW(hwnd, class_buf, 256)
                    if class_buf.value == "GHOST_WindowClass":
                        target_hwnd = hwnd
                        return False
                    length = user32.GetWindowTextLengthW(hwnd)
                    if length > 0:
                        buff = ctypes.create_unicode_buffer(length + 1)
                        user32.GetWindowTextW(hwnd, buff, length + 1)
                        if "blender" in buff.value.lower():
                            target_hwnd = hwnd
                            return False
            return True

        cb = WNDENUMPROC(enum_windows_proc)
        user32.EnumWindows(cb, 0)
        
        if not target_hwnd:
            target_hwnd = user32.FindWindowW("GHOST_WindowClass", None)

        if target_hwnd:
            fg_hwnd = user32.GetForegroundWindow()
            fg_tid = user32.GetWindowThreadProcessId(fg_hwnd, None)
            cur_tid = kernel32.GetCurrentThreadId()

            if fg_tid != cur_tid:
                user32.AttachThreadInput(cur_tid, fg_tid, True)

            if user32.IsIconic(target_hwnd):
                user32.ShowWindow(target_hwnd, 9) # 9 = SW_RESTORE
            else:
                user32.ShowWindow(target_hwnd, 5) # 5 = SW_SHOW

            user32.SetForegroundWindow(target_hwnd)
            user32.BringWindowToTop(target_hwnd)

            if fg_tid != cur_tid:
                user32.AttachThreadInput(cur_tid, fg_tid, False)

            user32.SwitchToThisWindow(target_hwnd, True)
            print(f"[Figma Bridge] Focused Blender window HWND: {target_hwnd}")
        else:
            print("[Figma Bridge] Could not find Blender HWND to focus.")
    except Exception as e:
        print(f"[Figma Bridge] Window focus error: {e}")

BRIDGE_PORT = 8765
IMPORT_QUEUE = queue.Queue()
HTTP_SERVER = None
SERVER_THREAD = None
IS_SERVER_RUNNING = False

class FigmaBridgeHandler(http.server.BaseHTTPRequestHandler):
    def _send_cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(200)
        self._send_cors()
        self.end_headers()

    def do_GET(self):
        if self.path in ["/health", "/status", "/"]:
            self.send_response(200)
            self._send_cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"status":"ok","blender":true}')
        else:
            self.send_response(404)
            self._send_cors()
            self.end_headers()

    def do_POST(self):
        if self.path == "/import":
            try:
                length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(length)
                payload = json.loads(body.decode("utf-8"))
                IMPORT_QUEUE.put(payload)
                self.send_response(200)
                self._send_cors()
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"status":"queued"}')
            except Exception as ex:
                self.send_response(500)
                self._send_cors()
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(ex)}).encode("utf-8"))
        else:
            self.send_response(404)
            self._send_cors()
            self.end_headers()

    def log_message(self, format, *args):
        pass

def bridge_timer_callback():
    global SETS
    while not IMPORT_QUEUE.empty():
        try:
            payload = IMPORT_QUEUE.get_nowait()
            context = bpy.context
            if not context or not hasattr(context, "scene"):
                continue
            
            p = context.scene.fui_props
            set_name = str(payload.get("name", "set1"))
            
            root = bpy.path.abspath(p.export_root) if p.export_root and os.path.isdir(bpy.path.abspath(p.export_root)) else None
            if not root:
                script_dir = os.path.dirname(bpy.data.filepath) if bpy.data.filepath else tempfile.gettempdir()
                root = os.path.join(script_dir, "exports")
                os.makedirs(root, exist_ok=True)
                p.export_root = root
                
            folder = os.path.join(root, set_name)
            os.makedirs(folder, exist_ok=True)
            
            try:
                with open(os.path.join(folder, "scene.json"), "w", encoding="utf-8") as f:
                    json.dump(payload, f, indent=2)
                if "manifest" in payload:
                    with open(os.path.join(folder, "manifest.json"), "w", encoding="utf-8") as f:
                        json.dump(payload["manifest"], f, indent=2)
            except Exception as e:
                print(f"[Figma Bridge] Warning saving local copy: {e}")
                
            imported_set = import_scene_data(payload, folder, context)
            
            SETS = scan(root)
            if SETS:
                context.scene.fui_props.selected_set = set_name
                
            if payload.get("auto_focus", True):
                focus_blender_window()
            print(f"[Figma Bridge] Successfully imported '{imported_set}' with {len(payload.get('nodes', []))} nodes.")
        except Exception as err:
            print(f"[Figma Bridge Error] {err}")
            import traceback
            traceback.print_exc()
            
    return 0.1

def start_bridge_server():
    global HTTP_SERVER, SERVER_THREAD, IS_SERVER_RUNNING
    if IS_SERVER_RUNNING:
        return
    try:
        class ReusableTCPServer(http.server.HTTPServer):
            allow_reuse_address = True
            
        HTTP_SERVER = ReusableTCPServer(("127.0.0.1", BRIDGE_PORT), FigmaBridgeHandler)
        SERVER_THREAD = threading.Thread(target=HTTP_SERVER.serve_forever, daemon=True)
        SERVER_THREAD.start()
        IS_SERVER_RUNNING = True
        if not bpy.app.timers.is_registered(bridge_timer_callback):
            bpy.app.timers.register(bridge_timer_callback, persistent=True)
        print(f"[Figma Bridge] Live server running on http://127.0.0.1:{BRIDGE_PORT}")
    except Exception as e:
        print(f"[Figma Bridge] Failed to start server: {e}")

def stop_bridge_server():
    global HTTP_SERVER, SERVER_THREAD, IS_SERVER_RUNNING
    if HTTP_SERVER:
        try:
            HTTP_SERVER.shutdown()
            HTTP_SERVER.server_close()
        except:
            pass
        HTTP_SERVER = None
    SERVER_THREAD = None
    IS_SERVER_RUNNING = False
    if bpy.app.timers.is_registered(bridge_timer_callback):
        bpy.app.timers.unregister(bridge_timer_callback)
    print("[Figma Bridge] Live server stopped.")

class StartBridge(Operator):
    bl_idname = "fui.start_bridge"; bl_label = "Start Bridge"
    def execute(self, context):
        start_bridge_server()
        return {"FINISHED"}

class StopBridge(Operator):
    bl_idname = "fui.stop_bridge"; bl_label = "Stop Bridge"
    def execute(self, context):
        stop_bridge_server()
        return {"FINISHED"}

class ImportSet(Operator):
    bl_idname="fui.import_set"; bl_label="Import Selected"
    def execute(self,context):
        p=context.scene.fui_props
        if p.selected_set=="NONE": return {"CANCELLED"}
        folder=os.path.join(bpy.path.abspath(p.export_root),p.selected_set)
        data=load_json(os.path.join(folder,"scene.json"))
        import_scene_data(data, folder, context)
        return {"FINISHED"}

class ApplyDepth(Operator):
    bl_idname="fui.apply_depth"; bl_label="Apply Layer Distance"
    def execute(self,context):
        update_depth(context); return {"FINISHED"}

class ApplyMaterialPreset(Operator):
    bl_idname = "fui.apply_material_preset"
    bl_label = "Apply Material Preset"
    bl_description = "Apply a visual material style to Figma UI materials"
    style: StringProperty()

    def execute(self, context):
        set_name = context.scene.fui_props.selected_set
        cname = "FIGMA_" + set_name
        col = bpy.data.collections.get(cname)
        if not col:
            for c in bpy.data.collections:
                if c.name.startswith("FIGMA_"):
                    col = c
                    break
        if not col:
            self.report({"WARNING"}, "No Figma collection found.")
            return {"CANCELLED"}

        count = 0
        for o in col.objects:
            if not o.data or not hasattr(o.data, "materials"):
                continue
            for m in o.data.materials:
                if not m or not m.use_nodes or not m.node_tree:
                    continue
                bsdf = m.node_tree.nodes.get("Principled BSDF")
                if not bsdf:
                    continue
                count += 1
                if self.style == "GLOSSY":
                    if "Roughness" in bsdf.inputs: bsdf.inputs["Roughness"].default_value = 0.15
                    if "Specular IOR Level" in bsdf.inputs: bsdf.inputs["Specular IOR Level"].default_value = 0.6
                    elif "Specular" in bsdf.inputs: bsdf.inputs["Specular"].default_value = 0.6
                    if "Transmission Weight" in bsdf.inputs: bsdf.inputs["Transmission Weight"].default_value = 0.0
                    elif "Transmission" in bsdf.inputs: bsdf.inputs["Transmission"].default_value = 0.0
                elif self.style == "GLASS":
                    if "Roughness" in bsdf.inputs: bsdf.inputs["Roughness"].default_value = 0.08
                    if "Transmission Weight" in bsdf.inputs: bsdf.inputs["Transmission Weight"].default_value = 0.8
                    elif "Transmission" in bsdf.inputs: bsdf.inputs["Transmission"].default_value = 0.8
                    if "IOR" in bsdf.inputs: bsdf.inputs["IOR"].default_value = 1.45
                    if hasattr(m, 'blend_method'):
                        try: m.blend_method = 'BLEND'
                        except: pass
                elif self.style == "MATTE":
                    if "Roughness" in bsdf.inputs: bsdf.inputs["Roughness"].default_value = 0.95
                    if "Specular IOR Level" in bsdf.inputs: bsdf.inputs["Specular IOR Level"].default_value = 0.05
                    elif "Specular" in bsdf.inputs: bsdf.inputs["Specular"].default_value = 0.05
                    if "Transmission Weight" in bsdf.inputs: bsdf.inputs["Transmission Weight"].default_value = 0.0
                    elif "Transmission" in bsdf.inputs: bsdf.inputs["Transmission"].default_value = 0.0

        self.report({"INFO"}, f"Applied {self.style} style to {count} materials.")
        return {"FINISHED"}

class Setup3PointLights(Operator):
    bl_idname = "fui.setup_3point_lights"
    bl_label = "Setup Studio Lights"
    bl_description = "Create or update 2 white studio lights (1000W & 800W) locked to the main UI empty"

    def execute(self, context):
        import mathutils

        figma_objs = [o for o in bpy.data.objects if ("figma_id" in o or "figma_set" in o) and o.type in {'MESH', 'CURVE'}]
        if not figma_objs:
            figma_objs = [o for o in bpy.data.objects if o.type in {'MESH', 'CURVE'}]

        min_x = min_y = min_z = float('inf')
        max_x = max_y = max_z = float('-inf')

        for o in figma_objs:
            for corner in o.bound_box:
                world_co = o.matrix_world @ mathutils.Vector(corner)
                min_x = min(min_x, world_co.x)
                max_x = max(max_x, world_co.x)
                min_y = min(min_y, world_co.y)
                max_y = max(max_y, world_co.y)
                min_z = min(min_z, world_co.z)
                max_z = max(max_z, world_co.z)

        if min_x == float('inf'):
            cx, cy, cz = 0.0, 0.0, 0.0
            span = 5.0
        else:
            cx = (min_x + max_x) / 2.0
            cy = (min_y + max_y) / 2.0
            cz = (min_z + max_z) / 2.0
            span = max(max_x - min_x, max_y - min_y, 1.0)

        # Locate main empty of the UI (FIGMA_*_ROOT)
        root_empty = None
        for o in bpy.data.objects:
            if o.type == 'EMPTY' and o.name.startswith("FIGMA_") and o.name.endswith("_ROOT"):
                root_empty = o
                break
        if not root_empty:
            for o in bpy.data.objects:
                if o.type == 'EMPTY' and "figma_set" in o:
                    root_empty = o
                    break
        if not root_empty:
            root_empty = bpy.data.objects.new("FIGMA_TARGET_EMPTY", None)
            root_empty.empty_display_type = 'PLAIN_AXES'
            root_empty.empty_display_size = 0.2
            root_empty.location = (cx, cy, cz)
            bpy.context.scene.collection.objects.link(root_empty)

        col_name = "FIGMA_STUDIO_LIGHTS"
        col = bpy.data.collections.get(col_name)
        if not col:
            col = bpy.data.collections.new(col_name)
            bpy.context.scene.collection.children.link(col)

        # Remove previous 3rd rim light if present
        old_rim = bpy.data.objects.get("FUI_Rim_Light")
        if old_rim:
            try: bpy.data.objects.remove(old_rim, do_unlink=True)
            except: pass

        def setup_light(name, pos, energy, size):
            obj = bpy.data.objects.get(name)
            if not obj:
                light_data = bpy.data.lights.new(name=name, type='AREA')
                obj = bpy.data.objects.new(name=name, object_data=light_data)
                col.objects.link(obj)
            else:
                light_data = obj.data
                if obj.name not in col.objects:
                    col.objects.link(obj)

            light_data.type = 'AREA'
            light_data.color = (1.0, 1.0, 1.0) # Pure white
            light_data.energy = energy
            light_data.size = size
            light_data.shape = 'SQUARE'
            obj.location = pos

            # Locked Track To constraint targeting the main UI empty
            con = obj.constraints.get("Track_To_UI")
            if not con:
                con = obj.constraints.new('TRACK_TO')
                con.name = "Track_To_UI"
            con.target = root_empty
            con.track_axis = 'TRACK_NEGATIVE_Z'
            con.up_axis = 'UP_Y'
            return obj

        # Light 1: Key Light at 1000W (Front-Right-High)
        key_pos = (cx + span * 0.7, cy - span * 0.7, cz + span * 0.8)
        setup_light("FUI_Key_Light", key_pos, 1000.0, span * 0.4)

        # Light 2: Fill Light at 800W (Front-Left-Mid)
        fill_pos = (cx - span * 0.8, cy - span * 0.5, cz + span * 0.5)
        setup_light("FUI_Fill_Light", fill_pos, 800.0, span * 0.6)

        self.report({"INFO"}, f"Created 2 studio lights (1000W & 800W) locked to {root_empty.name}")
        return {"FINISHED"}

class ApplySolidify(Operator):
    bl_idname = "fui.apply_solidify"
    bl_label = "Apply / Refresh Solidify"
    bl_description = "Apply or refresh 3D solidify thickness on Figma layers"

    def execute(self, context):
        count = apply_solidify_to_objects(context)
        self.report({'INFO'}, f"Solidify updated on {count} object(s)")
        return {'FINISHED'}

class RemoveSolidify(Operator):
    bl_idname = "fui.remove_solidify"
    bl_label = "Remove Solidify"
    bl_description = "Remove 3D solidify thickness from targeted Figma layers"

    def execute(self, context):
        count = remove_solidify_from_objects(context)
        self.report({'INFO'}, f"Removed solidify from {count} object(s)")
        return {'FINISHED'}

class FilterSelect(Operator):
    bl_idname = "fui.filter_select"
    bl_label = "Filter Select"
    bl_description = "Select objects matching the target category"
    category: StringProperty(name="Category", default="ALL")

    def execute(self, context):
        count = filter_select_objects(context, self.category)
        label = {"ALL": "all Figma", "CARDS": "cards & plates", "SVG": "SVG & icons", "TEXT": "text"}.get(self.category, self.category)
        self.report({'INFO'}, f"Selected {count} {label} object(s)")
        return {'FINISHED'}

class Panel(Panel):
    bl_label = "Figment Bridge"
    bl_idname = "FUI_PT_panel"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Figment Bridge"

    def draw(self, context):
        l = self.layout
        p = context.scene.fui_props

        # 1. Bridge Status
        box = l.box()
        col = box.column(align=True)
        if IS_SERVER_RUNNING:
            row = col.row(align=True)
            row.label(text="Bridge: Active (8765)", icon="CHECKMARK")
            row.operator("fui.stop_bridge", text="Stop", icon="CANCEL")
        else:
            row = col.row(align=True)
            row.label(text="Bridge: Inactive", icon="ERROR")
            row.operator("fui.start_bridge", text="Start", icon="PLAY")

        # 2. 3D Layer Hierarchy & Spacing
        box = l.box()
        col = box.column(align=False)
        col.label(text="3D Layer Spacing:", icon="CON_TRANSLIKE")
        col.prop(p, "layer_distance", text="Separation")
        col.operator("fui.apply_depth", text="Re-apply Distance", icon="FILE_REFRESH")

        obj = context.active_object
        if obj and "figma_depth" in obj:
            col.separator()
            label_name = (obj.name[:16] + "..") if len(obj.name) > 18 else obj.name
            col.label(text=f"Selected: {label_name}", icon="LAYER_ACTIVE")
            col.prop(obj, "fui_local_offset", text="Layer Nudge Z")

        # 3. Quick Filter Selection
        box = l.box()
        col = box.column(align=False)
        col.label(text="Quick Filter Selection:", icon="RESTRICT_SELECT_OFF")
        row = col.row(align=True)
        op = row.operator("fui.filter_select", text="All", icon="SELECT_SET")
        op.category = "ALL"
        op = row.operator("fui.filter_select", text="Cards", icon="MESH_PLANE")
        op.category = "CARDS"
        op = row.operator("fui.filter_select", text="Text", icon="FONT_DATA")
        op.category = "TEXT"

        # 4. 3D Solidify & Thickness
        box = l.box()
        col = box.column(align=False)
        col.label(text="3D Solidify & Thickness:", icon="MOD_SOLIDIFY")
        col.prop(p, "auto_solidify", text="Auto-Solidify on Import")
        
        row = col.row(align=True)
        row.prop(p, "solidify_target", text="")
        
        target = p.solidify_target
        if target == 'GLOBAL':
            col.prop(p, "solidify_thickness_global", text="Global Thickness")
        elif target == 'CARDS':
            col.prop(p, "solidify_thickness_cards", text="Cards Thickness")
        elif target == 'SVG':
            col.prop(p, "solidify_thickness_svg", text="SVG/Icons Thickness")
        elif target == 'TEXT':
            col.prop(p, "solidify_thickness_text", text="Text Thickness")
            
        row_btn = col.row(align=True)
        row_btn.operator("fui.apply_solidify", text="Apply / Refresh", icon="CHECKMARK")
        row_btn.operator("fui.remove_solidify", text="Remove", icon="X")

        # 5. Material Look Presets
        box = l.box()
        col = box.column(align=False)
        col.label(text="Material Look Presets:", icon="MATERIAL")
        row = col.row(align=True)
        op = row.operator("fui.apply_material_preset", text="Glossy", icon="SHADING_RENDERED")
        op.style = "GLOSSY"
        op = row.operator("fui.apply_material_preset", text="Glass", icon="MATERIAL")
        op.style = "GLASS"
        op = row.operator("fui.apply_material_preset", text="Matte", icon="SHADING_SOLID")
        op.style = "MATTE"

        # 6. Studio Lighting & Shadows
        box = l.box()
        col = box.column(align=False)
        col.label(text="Studio Lighting & Shadows:", icon="LIGHT")
        col.operator("fui.setup_3point_lights", text="Setup Studio Lights", icon="LIGHT_SUN")
        col.prop(p, "cast_text_shadows", text="Text & Icon Shadows")

        # 7. Manual Disk Import
        box = l.box()
        col = box.column(align=False)
        col.label(text="Manual Disk Import:", icon="FOLDER_REDIRECT")
        col.prop(p, "export_root", text="")
        row = col.row(align=True)
        row.operator("fui.refresh", icon="FILE_REFRESH")
        row.operator("fui.import_set", icon="IMPORT")
        col.prop(p, "selected_set", text="")

classes = (Props, Refresh, ImportSet, ApplyDepth, ApplySolidify, RemoveSolidify, FilterSelect, ApplyMaterialPreset, Setup3PointLights, StartBridge, StopBridge, Panel)

@bpy.app.handlers.persistent
def on_blend_load(dummy):
    start_bridge_server()

def register():
    for c in classes:
        bpy.utils.register_class(c)
    bpy.types.Scene.fui_props = PointerProperty(type=Props)
    bpy.types.Object.fui_local_offset = FloatProperty(
        name="Local Offset", default=0.0, step=0.5, precision=4, update=object_offset_changed
    )
    if on_blend_load not in bpy.app.handlers.load_post:
        bpy.app.handlers.load_post.append(on_blend_load)
    start_bridge_server()

def unregister():
    if on_blend_load in bpy.app.handlers.load_post:
        bpy.app.handlers.load_post.remove(on_blend_load)
    stop_bridge_server()
    if hasattr(bpy.types.Object, "fui_local_offset"):
        del bpy.types.Object.fui_local_offset
    if hasattr(bpy.types.Scene, "fui_props"):
        del bpy.types.Scene.fui_props
    for c in reversed(classes):
        try:
            bpy.utils.unregister_class(c)
        except:
            pass

if __name__ == "__main__":
    register()
