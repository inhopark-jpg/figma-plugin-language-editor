// Language Variables Editor — main thread (Figma sandbox)
// Manages STRING variables inside the "language" collection only.
// Grouping mirrors the canvas Page > Section > Section hierarchy.

var COLLECTION_NAME = "language";
var RECENT_KEY = "language_vars_recent";
var LANG_KEY = "language_vars_lang";
var MAX_RECENT = 20;
var WARN = "⚠️";
var MISSING = "--"; // placeholder for an untranslated / missing mode value
var currentLang = "en"; // cached UI language; updated from clientStorage / set-lang

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
// Variable identity (ID-based naming)
// ---------------------------------------------------------------------------
// Each variable's leaf is a stable 6-char lowercase alphanumeric ID that acts
// as its permanent identifier — independent of its value or location. This is
// what CSV export/import matches on, so a variable can move groups or change
// text without breaking the round-trip.

// Remove a leading ⚠️ flag (added to the leaf when a key layer is missing) so
// the underlying ID can be read.
function stripWarn(leaf) {
  return leaf.indexOf(WARN) === 0 ? leaf.replace(/^⚠️\s*/, "") : leaf;
}

var ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
function genId(used) {
  var id;
  do {
    id = "";
    for (var i = 0; i < 6; i++) id += ID_CHARS.charAt(Math.floor(Math.random() * ID_CHARS.length));
  } while (used[id]);
  used[id] = true;
  return id;
}

// A mode value counts as "missing" when it is empty, whitespace, or only
// dashes ("-", "--", …). Non-string values (aliases) are not flagged.
function isMissingValue(val) {
  if (typeof val !== "string") return false;
  var t = val.trim();
  return t === "" || /^-+$/.test(t);
}

// ---------------------------------------------------------------------------
// Localized toast strings (figma.notify). Values may be strings or functions.
// ---------------------------------------------------------------------------
var STRINGS = {
  en: {
    noCollection: 'No "language" collection found.',
    noLinkedVar: "No linked variable to edit.",
    varGone: "Variable no longer exists.",
    saved: "Saved.",
    selectFirst: "Select a text layer first.",
    varNotFound: "Variable not found.",
    assigned: "Variable assigned.",
    assignedN: function (n) { return "Assigned to " + n + " layer" + (n === 1 ? "" : "s") + "."; },
    defaultRequired: "The default mode value is required.",
    created: "Variable created and assigned.",
    scanning: "Scanning layers…",
    layerNotFound: "Layer not found — it may have been deleted.",
    noBinding: "No variable binding found on this layer.",
    unlinked: "Variable unlinked.",
    deleted: "Variable deleted.",
    couldNotAddMode: function (name, err) { return 'Could not add mode "' + name + '": ' + err; },
    errorPrefix: function (msg) { return "Error: " + msg; },
    cleanupSummary: function (p) {
      var s = "Cleaned up " + p.renamed + " variable" + (p.renamed === 1 ? "" : "s") + ".";
      if (p.migrated) s += " " + p.migrated + " given IDs.";
      if (p.regrouped) s += " " + p.regrouped + " regrouped.";
      if (p.flagged) s += " " + p.flagged + " missing key layer.";
      if (p.broken) s += " " + p.broken + " broken link" + (p.broken === 1 ? "" : "s") + ".";
      if (p.missing) s += " " + p.missing + " with missing values.";
      if (p.failed) s += " " + p.failed + " failed.";
      return s;
    },
    importSummary: function (p) {
      var s = "Imported: " + p.updated + " variable" + (p.updated === 1 ? "" : "s") + " updated.";
      if (p.newModes) s += " " + p.newModes + " new mode" + (p.newModes === 1 ? "" : "s") + ".";
      if (p.unmatched) s += " " + p.unmatched + " unmatched.";
      return s;
    },
  },
  ko: {
    noCollection: '"language" 컬렉션을 찾을 수 없습니다.',
    noLinkedVar: "편집할 연결된 변수가 없습니다.",
    varGone: "변수가 더 이상 존재하지 않습니다.",
    saved: "저장되었습니다.",
    selectFirst: "먼저 텍스트 레이어를 선택하세요.",
    varNotFound: "변수를 찾을 수 없습니다.",
    assigned: "변수가 적용되었습니다.",
    assignedN: function (n) { return "레이어 " + n + "개에 적용되었습니다."; },
    defaultRequired: "기본 모드 값을 입력해야 합니다.",
    created: "변수가 생성되고 적용되었습니다.",
    scanning: "레이어를 검색하는 중…",
    layerNotFound: "레이어를 찾을 수 없습니다 — 삭제되었을 수 있습니다.",
    noBinding: "이 레이어에 연결된 변수가 없습니다.",
    unlinked: "변수 연결이 해제되었습니다.",
    deleted: "변수가 삭제되었습니다.",
    couldNotAddMode: function (name, err) { return '"' + name + '" 모드를 추가할 수 없습니다: ' + err; },
    errorPrefix: function (msg) { return "오류: " + msg; },
    cleanupSummary: function (p) {
      var s = "변수 " + p.renamed + "개를 정리했습니다.";
      if (p.migrated) s += " " + p.migrated + "개에 ID 부여.";
      if (p.regrouped) s += " " + p.regrouped + "개 그룹 변경.";
      if (p.flagged) s += " 키 레이어 없음 " + p.flagged + "개.";
      if (p.broken) s += " 연결 끊김 " + p.broken + "개.";
      if (p.missing) s += " 값 누락 " + p.missing + "개.";
      if (p.failed) s += " 실패 " + p.failed + "개.";
      return s;
    },
    importSummary: function (p) {
      var s = "가져오기 완료: 변수 " + p.updated + "개 업데이트됨.";
      if (p.newModes) s += " 새 모드 " + p.newModes + "개.";
      if (p.unmatched) s += " 일치하지 않음 " + p.unmatched + "개.";
      return s;
    },
  },
};

function L(key) {
  var v = (STRINGS[currentLang] || STRINGS.en)[key];
  if (v == null) v = STRINGS.en[key];
  return v == null ? key : v;
}

async function getLang() {
  try {
    var l = await figma.clientStorage.getAsync(LANG_KEY);
    return l === "ko" ? "ko" : "en";
  } catch (e) { return "en"; }
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
  return { id: v.id, name: v.name, group: parts.group, leaf: parts.leaf, varId: stripWarn(parts.leaf), valuesByMode: valuesByMode };
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
  currentLang = await getLang();
  var ctx = await getContext();
  if (!ctx.collection) {
    figma.ui.postMessage({ type: "state", selection: "no-collection", lang: currentLang });
    return;
  }

  var sel = figma.currentPage.selection;
  var recentIds = await getRecentIds();
  var allVarsSerialized = ctx.stringVars.map(serializeVar);
  // allVars included in every branch so Export CSV works regardless of selection.
  var common = { modes: ctx.modes, defaultModeId: ctx.defaultModeId, allVars: allVarsSerialized, recentIds: recentIds, lang: currentLang };

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
  if (!binding || !binding.variableId) return notify(L("noLinkedVar"));
  var ctx = await getContext();
  if (!ctx.collection) return notify(L("noCollection"));
  var variable = null;
  for (var i = 0; i < ctx.stringVars.length; i++) {
    if (ctx.stringVars[i].id === binding.variableId) { variable = ctx.stringVars[i]; break; }
  }
  if (!variable) return notify(L("varGone"));

  for (var modeId in values) {
    variable.setValueForMode(modeId, values[modeId]);
  }
  notify(L("saved"));
  await pushState();
}

async function handleSwap(variableId) {
  var node = figma.currentPage.selection[0];
  var binding = resolveBinding(node);
  if (!binding) return notify(L("selectFirst"));
  var ctx = await getContext();
  if (!ctx.collection) return notify(L("noCollection"));
  var variable = null;
  for (var i = 0; i < ctx.stringVars.length; i++) {
    if (ctx.stringVars[i].id === variableId) { variable = ctx.stringVars[i]; break; }
  }
  if (!variable) return notify(L("varNotFound"));

  applyBinding(binding, variable);
  await addRecentId(variableId);
  notify(L("assigned"));
  await pushState();
}

async function handleMultiSwap(variableId) {
  var ctx = await getContext();
  if (!ctx.collection) return notify(L("noCollection"));
  var variable = null;
  for (var i = 0; i < ctx.stringVars.length; i++) {
    if (ctx.stringVars[i].id === variableId) { variable = ctx.stringVars[i]; break; }
  }
  if (!variable) return notify(L("varNotFound"));

  var sel = figma.currentPage.selection;
  var applied = 0;
  for (var si = 0; si < sel.length; si++) {
    var b = resolveBinding(sel[si]);
    if (b) { applyBinding(b, variable); applied++; }
  }
  await addRecentId(variableId);
  notify(L("assignedN")(applied));
  await pushState();
}

async function handleCreate(values) {
  var ctx = await getContext();
  if (!ctx.collection) return notify(L("noCollection"));

  var node = figma.currentPage.selection[0];
  var binding = resolveBinding(node);
  if (!binding) return notify(L("selectFirst"));

  var defaultVal = values[ctx.defaultModeId];
  if (!defaultVal || !defaultVal.trim()) {
    return notify(L("defaultRequired"));
  }

  var groupPath = getGroupPath(node);

  // Leaf is a unique 6-char ID — independent of value/location.
  var existingIds = {};
  for (var ei = 0; ei < ctx.stringVars.length; ei++) {
    existingIds[stripWarn(splitName(ctx.stringVars[ei].name).leaf)] = true;
  }
  var id = genId(existingIds);
  var fullName = groupPath ? groupPath + "/" + id : id;

  var variable = figma.variables.createVariable(fullName, ctx.collection, "STRING");
  for (var mi = 0; mi < ctx.modes.length; mi++) {
    var m = ctx.modes[mi];
    var val = values[m.modeId];
    if (m.isDefault) val = defaultVal;
    else if (!val || !val.trim()) val = MISSING;
    variable.setValueForMode(m.modeId, val);
  }

  applyBinding(binding, variable);
  // Mark as ID-assigned so cleanup keeps this leaf rather than re-generating.
  try { variable.setPluginData("idAssigned", "1"); } catch (e) {}
  // Record which node is this variable's "key" — its home location. Cleanup
  // follows this node so the variable's group tracks the key when it moves.
  try { variable.setPluginData("keyNodeId", node.id); } catch (e) {}
  await addRecentId(variable.id);
  notify(L("created"));
  await pushState();
}

var BROKEN_CAP = 200; // max broken-node entries kept for the report

// Scan every TEXT/INSTANCE node across all pages, keeping only O(variables)
// state so large documents don't exhaust the plugin's memory.
// Inputs:
//   keyNodeToVar      — { nodeId: varId } from each variable's stored keyNodeId
//   recordedGroupByVar — { varId: group } parsed from each variable's name
// Returns:
//   keyGroupByVar  — { varId: group } current group of a variable's stored key node
//   backfillByVar  — { varId: { nodeId, group } } a bound node sitting at the
//                    recorded group (used to adopt a key when none is stored)
//   brokenNodes    — [{ nodeId, nodeName, groupPath }] (capped) bound to deleted vars
//   brokenTotal    — full count of broken nodes (may exceed the capped array)
async function scanBoundNodes(ctx, allVarIds, keyNodeToVar, recordedGroupByVar) {
  // Skip descending into invisible instance sub-trees — the single biggest
  // memory/perf win in component-heavy files.
  figma.skipInvisibleInstanceChildren = true;
  await figma.loadAllPagesAsync();

  var langIds = {};
  for (var i = 0; i < ctx.stringVars.length; i++) langIds[ctx.stringVars[i].id] = true;

  var keyGroupByVar = {};
  var backfillByVar = {};
  var brokenNodes = [];
  var brokenTotal = 0;

  var pages = figma.root.children;
  for (var p = 0; p < pages.length; p++) {
    var nodes = pages[p].findAllWithCriteria({ types: ["TEXT", "INSTANCE"] });
    for (var n = 0; n < nodes.length; n++) {
      var node = nodes[n];
      var b = resolveBinding(node);
      if (!b || !b.variableId) continue;

      if (langIds[b.variableId]) {
        var varId = b.variableId;
        var isKey = keyNodeToVar[node.id] === varId && keyGroupByVar[varId] === undefined;
        var wantBackfill = backfillByVar[varId] === undefined && keyGroupByVar[varId] === undefined;
        // Only compute the (relatively cheap) group path when it can matter.
        if (isKey || wantBackfill) {
          var gp = getGroupPath(node);
          if (isKey) keyGroupByVar[varId] = gp;
          if (wantBackfill && gp.toLowerCase() === (recordedGroupByVar[varId] || "").toLowerCase()) {
            backfillByVar[varId] = { nodeId: node.id, group: gp };
          }
        }
      } else if (!allVarIds[b.variableId]) {
        // Variable ID not in any collection — the variable was deleted.
        brokenTotal++;
        if (brokenNodes.length < BROKEN_CAP) {
          brokenNodes.push({ nodeId: node.id, nodeName: node.name, groupPath: getGroupPath(node) });
        }
      }
    }
    nodes = null; // let each page's node array be collected before the next
  }
  return { keyGroupByVar: keyGroupByVar, backfillByVar: backfillByVar, brokenNodes: brokenNodes, brokenTotal: brokenTotal };
}

async function handleCleanup() {
  var ctx = await getContext();
  if (!ctx.collection) return notify(L("noCollection"));

  notify(L("scanning"));

  // Get every local variable ID (all collections/types) so we can detect
  // nodes whose bound variable was deleted from the document entirely.
  var allLocalVars = await figma.variables.getLocalVariablesAsync();
  var allVarIds = {};
  for (var ai = 0; ai < allLocalVars.length; ai++) allVarIds[allLocalVars[ai].id] = true;

  // Precompute per-variable lookups so the scan needs only O(variables) memory.
  var recordedGroupByVar = {};
  var keyNodeToVar = {};
  for (var q = 0; q < ctx.stringVars.length; q++) {
    var qv = ctx.stringVars[q];
    recordedGroupByVar[qv.id] = splitName(qv.name).group;
    var kn = "";
    try { kn = qv.getPluginData("keyNodeId"); } catch (e) {}
    if (kn) keyNodeToVar[kn] = qv.id;
  }

  var scanResult = await scanBoundNodes(ctx, allVarIds, keyNodeToVar, recordedGroupByVar);
  var keyGroupByVar = scanResult.keyGroupByVar;
  var backfillByVar = scanResult.backfillByVar;
  var brokenNodes = scanResult.brokenNodes;
  var brokenTotal = scanResult.brokenTotal;

  // Seed the used-ID set with every already-assigned variable's ID so that
  // newly migrated variables can't collide with them.
  var usedIds = {};
  for (var s2 = 0; s2 < ctx.stringVars.length; s2++) {
    var sv = ctx.stringVars[s2];
    var assigned = "";
    try { assigned = sv.getPluginData("idAssigned"); } catch (e) {}
    if (assigned === "1") usedIds[stripWarn(splitName(sv.name).leaf)] = true;
  }

  var CAP = 200; // max flagged / missing entries kept for the report
  var renamed = 0;
  var regrouped = 0;
  var migrated = 0;
  var failed = 0;
  var flagged = [];       // [{ id, group, leaf }] — variables with no key layer
  var flaggedTotal = 0;
  var missingValues = []; // [{ id, group, modes:[names] }] — untranslated values
  var missingTotal = 0;

  for (var vi = 0; vi < ctx.stringVars.length; vi++) {
    var v = ctx.stringVars[vi];

    var rawName = v.name;
    var parts = splitName(rawName);
    var recordedGroup = parts.group;

    // ---- Determine the key node's current group (its home location) ----
    // A variable HAS a key when either: its stored key node is still bound
    // (we follow it wherever it moved), or a bound node currently sits at the
    // recorded group (re-created / unmoved key). Otherwise the key is missing.
    var keyGroup = null;
    if (keyGroupByVar[v.id] !== undefined) {
      keyGroup = keyGroupByVar[v.id];
    } else if (backfillByVar[v.id]) {
      keyGroup = backfillByVar[v.id].group; // equals recordedGroup
      try { v.setPluginData("keyNodeId", backfillByVar[v.id].nodeId); } catch (e) {}
    }

    var keyMissing = keyGroup === null;
    var group = keyMissing ? recordedGroup : keyGroup;

    // ---- Resolve the ID (migrating old text-based leaves on first run) ----
    var idAssigned = "";
    try { idAssigned = v.getPluginData("idAssigned"); } catch (e) {}
    var id;
    if (idAssigned === "1") {
      id = stripWarn(parts.leaf);
    } else {
      id = genId(usedIds);
      try { v.setPluginData("idAssigned", "1"); } catch (e) {}
      migrated++;
    }
    usedIds[id] = true;

    // ---- Scan for missing (untranslated) mode values ----
    var missModes = [];
    for (var mm = 0; mm < ctx.modes.length; mm++) {
      if (isMissingValue(v.valuesByMode[ctx.modes[mm].modeId])) missModes.push(ctx.modes[mm].name);
    }
    if (missModes.length) {
      missingTotal++;
      if (missingValues.length < CAP) missingValues.push({ id: id, group: group, modes: missModes });
    }

    // ---- Build the final name (⚠️ flag on the leaf only) ----
    var flaggedLeaf = (keyMissing ? WARN + " " : "") + id;
    var finalName = (group ? group + "/" : "") + flaggedLeaf;

    if (keyMissing) {
      flaggedTotal++;
      if (flagged.length < CAP) flagged.push({ id: v.id, group: group, leaf: id });
    }

    if (finalName !== rawName) {
      var groupChanged = group !== recordedGroup;
      try {
        v.name = finalName;
        renamed++;
        if (groupChanged && !keyMissing) regrouped++;
      } catch (e) { failed++; }
    }
  }

  notify(L("cleanupSummary")({
    renamed: renamed, migrated: migrated, regrouped: regrouped,
    flagged: flaggedTotal, broken: brokenTotal, missing: missingTotal, failed: failed,
  }));

  if (flaggedTotal || brokenTotal || missingTotal) {
    // Keep the report on screen until the user dismisses it (don't pushState).
    figma.ui.postMessage({
      type: "cleanup-result",
      renamed: renamed, regrouped: regrouped, migrated: migrated,
      flagged: flagged, brokenNodes: brokenNodes, missingValues: missingValues,
      flaggedTotal: flaggedTotal, brokenTotal: brokenTotal, missingTotal: missingTotal,
    });
  } else {
    await pushState();
  }
}

async function handleNavigateToNode(nodeId) {
  await figma.loadAllPagesAsync();
  var node = figma.getNodeById(nodeId);
  if (!node) return notify(L("layerNotFound"));
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
  if (!node) return notify(L("layerNotFound"));
  var b = resolveBinding(node);
  if (!b) return notify(L("noBinding"));
  if (b.kind === "text") {
    b.node.setBoundVariable("characters", null);
  } else if (b.kind === "property") {
    var props = {};
    props[b.propName] = "";
    b.instance.setProperties(props);
  }
  // Don't push state — the UI stays on the report; Done triggers refresh.
  notify(L("unlinked"));
}

// Import CSV: match each row to a variable by its ID (column 5), then overwrite
// that variable's mode values from the mode columns. New mode columns are added
// to the collection. Rows with no matching variable are reported, not created.
async function handleImportCsv(headers, rows) {
  var ctx = await getContext();
  if (!ctx.collection) return notify(L("noCollection"));

  // Map existing mode names → modeId (case-insensitive).
  var nameToModeId = {};
  for (var mi = 0; mi < ctx.modes.length; mi++) {
    nameToModeId[ctx.modes[mi].name.trim().toLowerCase()] = ctx.modes[mi].modeId;
  }

  // Resolve CSV mode columns (index >= 5), adding new modes as needed.
  var modeCols = [];      // [{ colIndex, modeId }]
  var newModeNames = [];
  var newModeIds = {};
  for (var c = 5; c < headers.length; c++) {
    var hname = String(headers[c] == null ? "" : headers[c]).trim();
    if (!hname) continue;
    var key = hname.toLowerCase();
    var modeId = nameToModeId[key];
    if (!modeId) {
      try {
        modeId = ctx.collection.addMode(hname);
      } catch (e) {
        notify(L("couldNotAddMode")(hname, (e && e.message ? e.message : String(e))));
        continue;
      }
      nameToModeId[key] = modeId;
      newModeIds[modeId] = true;
      newModeNames.push(hname);
    }
    modeCols.push({ colIndex: c, modeId: modeId });
  }

  // Re-fetch (addMode mutates the collection) and index variables by their ID.
  var freshAll = await figma.variables.getLocalVariablesAsync("STRING");
  var vars = freshAll.filter(function(v) { return v.variableCollectionId === ctx.collection.id; });
  var byId = {};
  for (var i = 0; i < vars.length; i++) {
    byId[stripWarn(splitName(vars[i].name).leaf)] = vars[i];
  }

  var csvIds = {};
  var updated = 0;
  var unmatched = [];

  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    if (!row || row.length === 0) continue;
    var vname = String(row[4] == null ? "" : row[4]).trim();
    if (!vname) continue;
    csvIds[vname] = true;

    var variable = byId[vname];
    if (!variable) {
      unmatched.push({
        variableName: vname,
        section1: row[0] || "", section2: row[1] || "", section3: row[2] || "", layer: row[3] || "",
      });
      continue;
    }
    for (var k = 0; k < modeCols.length; k++) {
      var cell = row[modeCols[k].colIndex];
      var val = String(cell == null ? "" : cell);
      if (val.trim() === "") val = MISSING;
      variable.setValueForMode(modeCols[k].modeId, val);
    }
    updated++;
  }

  // For each newly added mode, fill "--" on variables the CSV didn't cover.
  if (newModeNames.length) {
    for (var j = 0; j < vars.length; j++) {
      var vid = stripWarn(splitName(vars[j].name).leaf);
      if (csvIds[vid]) continue; // already set from its CSV row
      for (var nm in newModeIds) vars[j].setValueForMode(nm, MISSING);
    }
  }

  notify(L("importSummary")({
    updated: updated, newModes: newModeNames.length, unmatched: unmatched.length,
  }));

  figma.ui.postMessage({ type: "import-result", updated: updated, newModes: newModeNames, unmatched: unmatched });
}

async function handleExportCsv() {
  var ctx = await getContext();
  if (!ctx.collection) return notify(L("noCollection"));
  figma.ui.postMessage({
    type: "export-data",
    vars: ctx.stringVars.map(serializeVar),
    modes: ctx.modes,
  });
}

async function handleDeleteVar(variableId) {
  var ctx = await getContext();
  if (!ctx.collection) return notify(L("noCollection"));
  var variable = null;
  for (var i = 0; i < ctx.stringVars.length; i++) {
    if (ctx.stringVars[i].id === variableId) { variable = ctx.stringVars[i]; break; }
  }
  if (!variable) return notify(L("varNotFound"));
  variable.remove();
  // Don't push state — the UI stays on the report; Done triggers refresh.
  notify(L("deleted"));
}

function notify(message) {
  figma.notify(message);
  figma.ui.postMessage({ type: "notify", message: message });
}

figma.ui.onmessage = async function(msg) {
  try {
    if (msg.type === "ready")   { await pushState(); }
    else if (msg.type === "set-lang") {
      currentLang = msg.lang === "ko" ? "ko" : "en";
      try { await figma.clientStorage.setAsync(LANG_KEY, currentLang); } catch (e) {}
    }
    else if (msg.type === "notify")  { figma.notify(msg.message); }
    else if (msg.type === "export-csv") { await handleExportCsv(); }
    else if (msg.type === "import-csv") { await handleImportCsv(msg.headers, msg.rows); }
    else if (msg.type === "save")    { await handleSave(msg.values); }
    else if (msg.type === "swap")       { await handleSwap(msg.variableId); }
    else if (msg.type === "multi-swap") { await handleMultiSwap(msg.variableId); }
    else if (msg.type === "create")  { await handleCreate(msg.values); }
    else if (msg.type === "cleanup")      { await handleCleanup(); }
    else if (msg.type === "delete-var")  { await handleDeleteVar(msg.variableId); }
    else if (msg.type === "navigate-to-node") { await handleNavigateToNode(msg.nodeId); }
    else if (msg.type === "unlink-node")      { await handleUnlinkNode(msg.nodeId); }
    else if (msg.type === "refresh")     { await pushState(); }
  } catch (e) {
    notify(L("errorPrefix")(e && e.message ? e.message : String(e)));
  }
};

function safePushState() {
  pushState().catch(function(e) { notify(L("errorPrefix")(e && e.message ? e.message : String(e))); });
}

figma.on("selectionchange", safePushState);
figma.on("currentpagechange", safePushState);
