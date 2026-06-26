// Language Variables Editor — main thread (Figma sandbox)
// Manages STRING variables inside the "language" collection only.
// Grouping mirrors the canvas Page > Section > Section hierarchy.

var COLLECTION_NAME = "language";
var DEFAULT_MAX_LEN = 20;
var RECENT_KEY = "language_vars_recent";
var MAX_RECENT = 20;

figma.showUI(__html__, { width: 380, height: 560, themeColors: true });

// ---------------------------------------------------------------------------
// Naming rule
// ---------------------------------------------------------------------------
// Replace ASCII special characters and spaces with "-".  Existing dashes are
// kept, consecutive dashes are collapsed to one, and leading/trailing dashes
// are trimmed.  Characters above 0x7F (Korean, etc.) are preserved as-is.
// The replaced ranges below cover every ASCII char EXCEPT: "-" (0x2D),
// digits (0x30-0x39) and letters (0x41-0x5A, 0x61-0x7A).
function dashClean(value) {
  return String(value == null ? "" : value)
    .replace(/[\x00-\x2C\x2E-\x2F\x3A-\x40\x5B-\x60\x7B-\x7F]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function cleanLeaf(value, maxLen) {
  var limit = Number(maxLen) > 0 ? Number(maxLen) : DEFAULT_MAX_LEN;
  // Truncate, then re-trim a trailing dash the cut may have produced.
  return dashClean(value).slice(0, limit).replace(/-+$/g, "");
}

function splitName(fullName) {
  var i = fullName.lastIndexOf("/");
  if (i < 0) return { group: "", leaf: fullName };
  return { group: fullName.slice(0, i), leaf: fullName.slice(i + 1) };
}

// Build a group segment tagged "section-" or "layer-" so the two are easy to
// tell apart in the variables table.  An empty cleaned name collapses to just
// the tag (no trailing dash).
function buildSegment(kind, name) {
  return (kind + "-" + dashClean(name)).replace(/-+$/g, "").toLowerCase();
}

// ---------------------------------------------------------------------------
// Recency tracking (persisted per client via clientStorage)
// ---------------------------------------------------------------------------
async function getRecentIds() {
  try { return (await figma.clientStorage.getAsync(RECENT_KEY)) || []; }
  catch (e) { return []; }
}

async function addRecentId(id) {
  var list = await getRecentIds();
  list = list.filter(function(x) { return x !== id; });
  list.unshift(id);
  if (list.length > MAX_RECENT) list = list.slice(0, MAX_RECENT);
  try { await figma.clientStorage.setAsync(RECENT_KEY, list); } catch (e) {}
}

// ---------------------------------------------------------------------------
// Collection context
// ---------------------------------------------------------------------------
async function getContext() {
  var collections = await figma.variables.getLocalVariableCollectionsAsync();
  var collection = null;
  for (var ci = 0; ci < collections.length; ci++) {
    if (collections[ci].name === COLLECTION_NAME) { collection = collections[ci]; break; }
  }
  if (!collection) return { collection: null };

  var all = await figma.variables.getLocalVariablesAsync("STRING");
  var stringVars = all.filter(function(v) { return v.variableCollectionId === collection.id; });
  var modes = collection.modes.map(function(m) {
    return { modeId: m.modeId, name: m.name, isDefault: m.modeId === collection.defaultModeId };
  });
  return { collection: collection, stringVars: stringVars, modes: modes, defaultModeId: collection.defaultModeId };
}

function serializeVar(v) {
  var parts = splitName(v.name);
  var valuesByMode = {};
  for (var mid in v.valuesByMode) {
    var val = v.valuesByMode[mid];
    valuesByMode[mid] = typeof val === "string" ? val : null;
  }
  return { id: v.id, name: v.name, group: parts.group, leaf: parts.leaf, valuesByMode: valuesByMode };
}

// ---------------------------------------------------------------------------
// Section grouping for a node.
// Rule: 1st section / 2nd section / 3rd section / top-most-layer
// The page is NOT included.  "Top-most layer" = the first non-SECTION ancestor
// of the text node when traversed top-to-bottom (the frame/instance directly
// under the deepest tracked section, or directly under the page).  Sections
// beyond the 3rd are skipped but we keep walking to find that layer.  Each
// segment is tagged: sections start with "section-", the layer with "layer-".
// ---------------------------------------------------------------------------
function getGroupPath(node) {
  // Build ancestor chain top-to-bottom (not including PAGE itself).
  var ancestors = [];
  var cur = node.parent;
  while (cur && cur.type !== "PAGE") {
    ancestors.unshift(cur);
    cur = cur.parent;
  }

  var sections = [];
  var topLayerName = node.name; // fallback: text node itself has no containing frame

  for (var i = 0; i < ancestors.length; i++) {
    if (ancestors[i].type === "SECTION") {
      if (sections.length < 3) sections.push(ancestors[i].name);
      // Sections beyond 3 are silently skipped; keep iterating.
    } else {
      // First non-SECTION node encountered top-to-bottom is the top-most layer.
      topLayerName = ancestors[i].name;
      break;
    }
  }

  var parts = [];
  for (var s = 0; s < sections.length; s++) parts.push(buildSegment("section", sections[s]));
  parts.push(buildSegment("layer", topLayerName));
  return parts.join("/");
}

// ---------------------------------------------------------------------------
// Resolve where a string variable is bound for the selected node.
// ---------------------------------------------------------------------------
function findInstanceForProp(node, propRef) {
  var cur = node.parent;
  var firstInstance = null;
  while (cur && cur.type !== "PAGE") {
    if (cur.type === "INSTANCE") {
      if (!firstInstance) firstInstance = cur;
      if (cur.componentProperties && propRef in cur.componentProperties) return cur;
    }
    cur = cur.parent;
  }
  return firstInstance;
}

function resolveBinding(node) {
  if (!node) return null;

  if (node.type === "TEXT") {
    var propRef = node.componentPropertyReferences && node.componentPropertyReferences.characters;
    if (propRef) {
      var inst = findInstanceForProp(node, propRef);
      if (inst) {
        var cp = inst.componentProperties[propRef];
        var alias = cp && cp.boundVariables && cp.boundVariables.value;
        return { kind: "property", instance: inst, propName: propRef, variableId: alias ? alias.id : null };
      }
    }
    var bv = node.boundVariables && node.boundVariables.characters;
    return { kind: "text", node: node, variableId: bv ? bv.id : null };
  }

  if (node.type === "INSTANCE") {
    for (var key in node.componentProperties) {
      var cp2 = node.componentProperties[key];
      if (cp2.type === "TEXT") {
        var alias2 = cp2.boundVariables && cp2.boundVariables.value;
        return { kind: "property", instance: node, propName: key, variableId: alias2 ? alias2.id : null };
      }
    }
  }

  return null;
}

function applyBinding(binding, variable) {
  if (binding.kind === "text") {
    binding.node.setBoundVariable("characters", variable);
  } else if (binding.kind === "property") {
    var props = {};
    props[binding.propName] = figma.variables.createVariableAlias(variable);
    binding.instance.setProperties(props);
  }
}

// ---------------------------------------------------------------------------
// Push the full state for the current selection to the UI.
// ---------------------------------------------------------------------------
async function pushState() {
  var ctx = await getContext();
  if (!ctx.collection) {
    figma.ui.postMessage({ type: "state", selection: "no-collection" });
    return;
  }

  var sel = figma.currentPage.selection;
  var common = { modes: ctx.modes, defaultModeId: ctx.defaultModeId };
  var recentIds = await getRecentIds();
  var allVarsSerialized = ctx.stringVars.map(serializeVar);

  if (sel.length === 0) {
    figma.ui.postMessage(Object.assign({ type: "state", selection: "none" }, common));
    return;
  }

  if (sel.length > 1) {
    // Check whether every selected node has a resolvable binding.
    var allValid = true;
    for (var si = 0; si < sel.length; si++) {
      if (!resolveBinding(sel[si])) { allValid = false; break; }
    }
    if (!allValid) {
      // Mixed selection — some nodes can't be bound; fall back to the error message.
      figma.ui.postMessage(Object.assign({ type: "state", selection: "multiple" }, common));
      return;
    }
    figma.ui.postMessage(Object.assign({ type: "state", selection: "multi-node" }, common, {
      count: sel.length,
      allVars: allVarsSerialized,
      recentIds: recentIds,
    }));
    return;
  }

  var node = sel[0];
  var binding = resolveBinding(node);
  if (!binding) {
    figma.ui.postMessage(Object.assign({ type: "state", selection: "unsupported" }, common));
    return;
  }

  var groupPath = getGroupPath(node);
  var groupVars = ctx.stringVars
    .filter(function(v) { return splitName(v.name).group === groupPath; })
    .map(serializeVar);

  var variable = null;
  var varMissing = false;
  if (binding.variableId) {
    // Cross-reference against the live variable list rather than getVariableByIdAsync,
    // which returns stale cached data for variables that have already been deleted.
    var found = null;
    for (var vi2 = 0; vi2 < ctx.stringVars.length; vi2++) {
      if (ctx.stringVars[vi2].id === binding.variableId) { found = ctx.stringVars[vi2]; break; }
    }
    if (found) { variable = serializeVar(found); }
    else { varMissing = true; }
  }

  figma.ui.postMessage(Object.assign({ type: "state", selection: "node" }, common, {
    bindingKind: binding.kind,
    hasVar: !!variable,
    varMissing: varMissing,
    variable: variable,
    groupPath: groupPath,
    groupVars: groupVars,
    allVars: allVarsSerialized,
    recentIds: recentIds,
    nodeName: node.name,
  }));
}

// ---------------------------------------------------------------------------
// Message handlers
// ---------------------------------------------------------------------------
async function handleSave(values) {
  var node = figma.currentPage.selection[0];
  var binding = resolveBinding(node);
  if (!binding || !binding.variableId) return notify("No linked variable to edit.");
  var ctx = await getContext();
  if (!ctx.collection) return notify('No "language" collection found.');
  var variable = null;
  for (var i = 0; i < ctx.stringVars.length; i++) {
    if (ctx.stringVars[i].id === binding.variableId) { variable = ctx.stringVars[i]; break; }
  }
  if (!variable) return notify("Variable no longer exists.");

  for (var modeId in values) {
    variable.setValueForMode(modeId, values[modeId]);
  }
  notify("Saved.");
  await pushState();
}

async function handleSwap(variableId) {
  var node = figma.currentPage.selection[0];
  var binding = resolveBinding(node);
  if (!binding) return notify("Select a text layer first.");
  var ctx = await getContext();
  if (!ctx.collection) return notify('No "language" collection found.');
  var variable = null;
  for (var i = 0; i < ctx.stringVars.length; i++) {
    if (ctx.stringVars[i].id === variableId) { variable = ctx.stringVars[i]; break; }
  }
  if (!variable) return notify("Variable not found.");

  applyBinding(binding, variable);
  await addRecentId(variableId);
  notify("Variable assigned.");
  await pushState();
}

async function handleMultiSwap(variableId) {
  var ctx = await getContext();
  if (!ctx.collection) return notify('No "language" collection found.');
  var variable = null;
  for (var i = 0; i < ctx.stringVars.length; i++) {
    if (ctx.stringVars[i].id === variableId) { variable = ctx.stringVars[i]; break; }
  }
  if (!variable) return notify("Variable not found.");

  var sel = figma.currentPage.selection;
  var applied = 0;
  for (var si = 0; si < sel.length; si++) {
    var b = resolveBinding(sel[si]);
    if (b) { applyBinding(b, variable); applied++; }
  }
  await addRecentId(variableId);
  notify("Assigned to " + applied + " layer" + (applied === 1 ? "" : "s") + ".");
  await pushState();
}

async function handleCreate(values, maxLen) {
  var ctx = await getContext();
  if (!ctx.collection) return notify('No "language" collection found.');

  var node = figma.currentPage.selection[0];
  var binding = resolveBinding(node);
  if (!binding) return notify("Select a text layer first.");

  var defaultVal = values[ctx.defaultModeId];
  if (!defaultVal || !defaultVal.trim()) {
    return notify("The default mode value is required.");
  }

  var groupPath = getGroupPath(node);
  var leaf = cleanLeaf(defaultVal, maxLen);
  var baseName = groupPath ? groupPath + "/" + leaf : leaf;

  var existingNames = {};
  for (var ei = 0; ei < ctx.stringVars.length; ei++) existingNames[ctx.stringVars[ei].name] = true;
  var fullName = baseName;
  var suffix = 2;
  while (existingNames[fullName]) fullName = baseName + "_" + suffix++;

  var variable = figma.variables.createVariable(fullName, ctx.collection, "STRING");
  for (var mi = 0; mi < ctx.modes.length; mi++) {
    var m = ctx.modes[mi];
    var val = values[m.modeId];
    if (m.isDefault) val = defaultVal;
    else if (!val || !val.trim()) val = "-";
    variable.setValueForMode(m.modeId, val);
  }

  applyBinding(binding, variable);
  // Record which node is this variable's "key" — its home location. Cleanup
  // follows this node so the variable's group tracks the key when it moves.
  try { variable.setPluginData("keyNodeId", node.id); } catch (e) {}
  await addRecentId(variable.id);
  notify("Variable created and assigned.");
  await pushState();
}

// Scan every TEXT/INSTANCE node across all pages.
// Returns:
//   map        — { varId: { byNode: { nodeId: groupPath }, list: [{id, groupPath}] } }
//                for every node bound to a language variable.
//   brokenNodes — [{ nodeId, nodeName, groupPath }] for nodes whose bound variable
//                 no longer exists in any local collection (truly deleted).
async function scanBoundNodes(ctx, allVarIds) {
  await figma.loadAllPagesAsync();

  var langIds = {};
  for (var i = 0; i < ctx.stringVars.length; i++) langIds[ctx.stringVars[i].id] = true;

  var map = {};
  var brokenNodes = [];
  var pages = figma.root.children;
  for (var p = 0; p < pages.length; p++) {
    var nodes = pages[p].findAllWithCriteria({ types: ["TEXT", "INSTANCE"] });
    for (var n = 0; n < nodes.length; n++) {
      var node = nodes[n];
      var b = resolveBinding(node);
      if (!b || !b.variableId) continue;

      if (langIds[b.variableId]) {
        var gp = getGroupPath(node);
        if (!map[b.variableId]) map[b.variableId] = { byNode: {}, list: [] };
        map[b.variableId].byNode[node.id] = gp;
        map[b.variableId].list.push({ id: node.id, groupPath: gp });
      } else if (!allVarIds[b.variableId]) {
        // Variable ID not found in any collection — the variable was deleted.
        brokenNodes.push({ nodeId: node.id, nodeName: node.name, groupPath: getGroupPath(node) });
      }
    }
  }
  return { map: map, brokenNodes: brokenNodes };
}

var WARN = "⚠️"; // ⚠️

async function handleCleanup(maxLen) {
  var ctx = await getContext();
  if (!ctx.collection) return notify('No "language" collection found.');

  notify("Scanning layers…");

  // Get every local variable ID (all collections/types) so we can detect
  // nodes whose bound variable was deleted from the document entirely.
  var allLocalVars = await figma.variables.getLocalVariablesAsync();
  var allVarIds = {};
  for (var ai = 0; ai < allLocalVars.length; ai++) allVarIds[allLocalVars[ai].id] = true;

  var scanResult = await scanBoundNodes(ctx, allVarIds);
  var boundMap   = scanResult.map;
  var brokenNodes = scanResult.brokenNodes;

  var used = {};
  var renamed = 0;
  var regrouped = 0;
  var failed = 0;
  var flagged = []; // [{ id, group, leaf }] — variables with no key layer, for the report

  for (var vi = 0; vi < ctx.stringVars.length; vi++) {
    var v = ctx.stringVars[vi];

    // ⚠️ lives in the leaf, so splitName gives us the clean group directly.
    var rawName = v.name;
    var recordedGroup = splitName(rawName).group;

    // ---- Determine the key node's current group (its home location) ----
    // A variable HAS a key when either: its stored key node is still bound
    // (we follow it wherever it moved), or a bound node currently sits at the
    // recorded group (re-created / unmoved key). Otherwise the key is missing.
    var keyGroup = null;
    var entry = boundMap[v.id];
    var keyId = "";
    try { keyId = v.getPluginData("keyNodeId"); } catch (e) {}

    if (entry) {
      if (keyId && entry.byNode[keyId] !== undefined) {
        keyGroup = entry.byNode[keyId];
      } else {
        for (var li = 0; li < entry.list.length; li++) {
          if (entry.list[li].groupPath.toLowerCase() === recordedGroup.toLowerCase()) {
            keyGroup = recordedGroup;
            try { v.setPluginData("keyNodeId", entry.list[li].id); } catch (e) {}
            break;
          }
        }
      }
    }

    var keyMissing = keyGroup === null;
    var group = keyMissing ? recordedGroup : keyGroup;

    // ---- Leaf from the default-mode value (naming rule) ----
    var defaultVal = v.valuesByMode[ctx.defaultModeId];
    var leaf = cleanLeaf(typeof defaultVal === "string" ? defaultVal : "", maxLen);
    if (!leaf) { used[rawName] = true; continue; }

    // ⚠️ goes on the leaf only so the group path stays clean and the variable
    // continues to appear in the correct group in the swap/assign list.
    var flaggedLeaf = (keyMissing ? WARN + " " : "") + leaf;
    var finalName = (group ? group + "/" : "") + flaggedLeaf;
    var n = 2;
    while (used[finalName] && finalName !== rawName) {
      finalName = (group ? group + "/" : "") + flaggedLeaf + "-" + n;
      n++;
    }
    used[finalName] = true;

    if (keyMissing) flagged.push({ id: v.id, group: group, leaf: leaf });

    if (finalName !== rawName) {
      var groupChanged = group !== recordedGroup;
      try {
        v.name = finalName;
        renamed++;
        if (groupChanged && !keyMissing) regrouped++;
      } catch (e) { failed++; }
    }
  }

  var msg = "Cleaned up " + renamed + " variable" + (renamed === 1 ? "" : "s") + ".";
  if (regrouped) msg += " " + regrouped + " regrouped.";
  if (flagged.length) msg += " " + flagged.length + " missing key layer.";
  if (brokenNodes.length) msg += " " + brokenNodes.length + " broken link" + (brokenNodes.length === 1 ? "" : "s") + ".";
  if (failed) msg += " " + failed + " failed.";
  notify(msg);

  if (flagged.length || brokenNodes.length) {
    // Keep the report on screen until the user dismisses it (don't pushState).
    figma.ui.postMessage({ type: "cleanup-result", renamed: renamed, regrouped: regrouped, flagged: flagged, brokenNodes: brokenNodes });
  } else {
    await pushState();
  }
}

async function handleNavigateToNode(nodeId) {
  await figma.loadAllPagesAsync();
  var node = figma.getNodeById(nodeId);
  if (!node) return notify("Layer not found — it may have been deleted.");
  // Switch to the page that contains this node before selecting.
  var cur = node.parent;
  while (cur && cur.type !== "PAGE") cur = cur.parent;
  if (cur && cur.type === "PAGE" && cur !== figma.currentPage) {
    figma.currentPage = cur;
  }
  figma.currentPage.selection = [node];
  figma.viewport.scrollAndZoomIntoView([node]);
}

async function handleUnlinkNode(nodeId) {
  await figma.loadAllPagesAsync();
  var node = figma.getNodeById(nodeId);
  if (!node) return notify("Layer not found — it may have been deleted.");
  var b = resolveBinding(node);
  if (!b) return notify("No variable binding found on this layer.");
  if (b.kind === "text") {
    b.node.setBoundVariable("characters", null);
  } else if (b.kind === "property") {
    var props = {};
    props[b.propName] = "";
    b.instance.setProperties(props);
  }
  // Don't push state — the UI stays on the report; Done triggers refresh.
  notify("Variable unlinked.");
}

async function handleDeleteVar(variableId) {
  var ctx = await getContext();
  if (!ctx.collection) return notify('No "language" collection found.');
  var variable = null;
  for (var i = 0; i < ctx.stringVars.length; i++) {
    if (ctx.stringVars[i].id === variableId) { variable = ctx.stringVars[i]; break; }
  }
  if (!variable) return notify("Variable not found.");
  variable.remove();
  // Don't push state — the UI stays on the report; Done triggers refresh.
  notify("Variable deleted.");
}

function notify(message) {
  figma.notify(message);
  figma.ui.postMessage({ type: "notify", message: message });
}

figma.ui.onmessage = async function(msg) {
  try {
    if (msg.type === "ready")   { await pushState(); }
    else if (msg.type === "save")    { await handleSave(msg.values); }
    else if (msg.type === "swap")       { await handleSwap(msg.variableId); }
    else if (msg.type === "multi-swap") { await handleMultiSwap(msg.variableId); }
    else if (msg.type === "create")  { await handleCreate(msg.values, msg.maxLen); }
    else if (msg.type === "cleanup")      { await handleCleanup(msg.maxLen); }
    else if (msg.type === "delete-var")  { await handleDeleteVar(msg.variableId); }
    else if (msg.type === "navigate-to-node") { await handleNavigateToNode(msg.nodeId); }
    else if (msg.type === "unlink-node")      { await handleUnlinkNode(msg.nodeId); }
    else if (msg.type === "refresh")     { await pushState(); }
  } catch (e) {
    notify("Error: " + (e && e.message ? e.message : String(e)));
  }
};

function safePushState() {
  pushState().catch(function(e) { notify("Error: " + (e && e.message ? e.message : String(e))); });
}

figma.on("selectionchange", safePushState);
figma.on("currentpagechange", safePushState);
