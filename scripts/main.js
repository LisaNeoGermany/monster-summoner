Hooks.once("init", () => {
  game.settings.register("monster-summoner", "monsterSubfolders", {
    name: "MONSTER_SUMMONER.Settings.MonsterSubfolders.Name",
    hint: "MONSTER_SUMMONER.Settings.MonsterSubfolders.Hint",
    scope: "world",
    config: true,
    type: String,
    default: ""
  });

  game.settings.register("monster-summoner", "summonSound", {
    name: "MONSTER_SUMMONER.Settings.SummonSound.Name",
    hint: "MONSTER_SUMMONER.Settings.SummonSound.Hint",
    scope: "world",
    config: true,
    type: String,
    default: ""
  });

  game.settings.register("monster-summoner", "summonAnimation", {
    name: "MONSTER_SUMMONER.Settings.SummonAnimation.Name",
    hint: "MONSTER_SUMMONER.Settings.SummonAnimation.Hint",
    scope: "world",
    config: true,
    type: String,
    default: ""
  });
});


function primaryGMId(){
  const gms = game.users.filter(u => u.isGM && u.active).sort((a,b)=> String(a.id).localeCompare(String(b.id)));
  return gms[0]?.id || null;
}

// --- Summoned actor cleanup ---
async function _msCleanupSummonedActors() {
  try {
    const me = game.user?.id;
    const primary = primaryGMId();
    if (!game.user.isGM || me !== primary) return;
    // Small extra wait to let any batched updates settle
    await foundry.utils.sleep(150);
    const doomed = game.actors.filter(a => {
      try {
        if (!a?.getFlag?.("monster-summoner", "temp")) return false;
        // Check ALL scenes for tokens linked to this actor
        const hasTokens = game.scenes.some(s => s.tokens.some(t => t.actorId === a.id));
        return !hasTokens;
      } catch(e) { return false; }
    });
    for (const a of doomed) {
      try { await a.delete(); } catch(e) {}
    }
  } catch(e) {}
}
Hooks.on("renderActorDirectory", () => _msCleanupSummonedActors());
Hooks.on("canvasReady", () => _msCleanupSummonedActors());
// --- end cleanup ---


Hooks.once("ready", () => {
  game.monsterSummoner = { openSummonDialog };

  Hooks.on("deleteToken", async (tokenDocument) => {
    try{
      // Only primary GM performs cleanup
      const me = game.user?.id;
      const primary = primaryGMId();
      if (!game.user.isGM || me !== primary) return;
      const actorId = tokenDocument?.actorId;
      if (!actorId) return;
      const actor = game.actors.get(actorId);
      if (!actor) return;
      if (!actor.getFlag("monster-summoner", "temp")) return;
      const active = actor.getActiveTokens(true);
      if (Array.isArray(active) && active.length > 0) return;
      await actor.delete();
    }catch(e){ /* swallow */ }
  });

  // Socket Listener
  game.socket.on("module.monster-summoner", async (data) => {
    if (data.type === "playSound") {
       if (data.sceneId && game.user.viewedScene !== data.sceneId) return;
       const soundPath = data.path;
       if (soundPath) {
         try {
           const audio = new Audio(soundPath);
           audio.volume = 0.10;
           await audio.play();
         } catch(e) { console.warn("Monster Summoner | PlaySound error", e); }
       }
    }

    if (data.type === "playAnimation") {
      await _msPlayAnimation(data.path, data.sceneId, data.tokenIds);
    }
    
    // GM Only: Handle Summon Request
    if (data.type === "summon" && game.user.isGM && game.user.id === primaryGMId()) {
       const { sourceActorId, x, y, summonerId, sceneId } = data;
       const sourceActor = game.actors.get(sourceActorId);
       if (!sourceActor) {
         console.warn(`Monster Summoner | Could not find source actor ${sourceActorId}`);
         return;
       }
       await spawnSingleMonster(sourceActor, x, y, sceneId, summonerId);
    }
  });

  try { _msCleanupSummonedActors(); } catch(e) {}
});

// Global selection that persists across folder navigation
let globalSelection = new Map(); // actorId -> { actor, count }

async function openSummonDialog(startFolderId = null, breadcrumbs = null, selection = null) {
  // Use passed selection or global selection
  if (selection !== null) {
    globalSelection = selection;
  }

  const folderIdString = game.settings.get("monster-summoner", "monsterSubfolders") || "";
  const allowedIds = folderIdString.split(",").map(s => s.trim()).filter(Boolean);

  let startFolders;
  let currentFolder = null;
  if (!startFolderId) {
    startFolders = allowedIds.map(id => game.folders.get(id)).filter(Boolean);
  } else {
    currentFolder = game.folders.get(startFolderId);
  }

  if (!breadcrumbs) {
    breadcrumbs = [];
    if (currentFolder) {
      let folder = currentFolder;
      while (folder) {
        breadcrumbs.unshift({ id: folder.id, name: folder.name });
        folder = folder.parent;
      }
    }
  }

  let actors = [];
  let subfolders = [];
  if (currentFolder) {
    actors = currentFolder.contents.filter(a => a.documentName === "Actor");
    actors = actors.slice().sort((a, b) => {
      const crA = parseCR(a.system?.details?.cr);
      const crB = parseCR(b.system?.details?.cr);
      if (crA === null && crB === null) return 0;
      if (crA === null) return 1;
      if (crB === null) return -1;
      return crA - crB;
    });
    subfolders = game.folders.filter(f => f.parent?.id === currentFolder.id && f.type === "Actor")
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  } else {
    subfolders = startFolders || [];
  }

  const monsterList = actors.map(actor => ({
    id:   actor.id,
    name: actor.name,
    img:  actor.prototypeToken?.texture?.src || actor.img,
    cr:   actor.system.details?.cr ?? "?"
  }));

  new SummonMonsterDialog(monsterList, subfolders, currentFolder?.id ?? null, breadcrumbs, globalSelection).render(true);
}

function parseCR(cr) {
  if (!cr) return null;
  if (typeof cr === "number") return cr;
  if (typeof cr === "string") {
    if (cr.includes("/")) {
      const parts = cr.split("/");
      if (parts.length === 2) {
        const num = parseFloat(parts[0]);
        const denom = parseFloat(parts[1]);
        if (!isNaN(num) && !isNaN(denom) && denom !== 0) {
          return num / denom;
        }
      }
    }
    const num = parseFloat(cr.replace(",", "."));
    if (!isNaN(num)) return num;
  }
  return null;
}

async function waitForClick(actorName, index, total, tokenTexture, tokenWidth, tokenHeight, placedPreviews) {
  return new Promise(resolve => {
    const message = game.i18n.format("MONSTER_SUMMONER.Dialog.Place", {
      name: actorName,
      current: index + 1,
      total: total
    });
    ui.notifications.info(message);

    // Create preview sprite
    let preview = null;
    const gridSize = canvas.grid.size;
    const w = (tokenWidth || 1) * gridSize;
    const h = (tokenHeight || 1) * gridSize;

    if (tokenTexture) {
      preview = new PIXI.Sprite(tokenTexture);
      preview.width = w;
      preview.height = h;
      preview.alpha = 0.7;
      preview.anchor.set(0.5, 0.5);
      canvas.stage.addChild(preview);
    }

    // Mouse move handler for preview
    const moveHandler = event => {
      if (preview) {
        const pos = event.data.getLocalPosition(canvas.stage);
        preview.x = pos.x;
        preview.y = pos.y;
      }
    };

    // Click handler
    const clickHandler = event => {
      canvas.stage.off("mousedown", clickHandler);
      canvas.stage.off("mousemove", moveHandler);

      const { x, y } = event.data.getLocalPosition(canvas.stage);

      // Keep preview at placed position
      if (preview) {
        preview.x = x;
        preview.y = y;
        preview.alpha = 0.5; // Make it slightly more transparent to show it's placed
        placedPreviews.push(preview);
      }

      resolve({ x, y });
    };

    canvas.stage.on("mousemove", moveHandler);
    canvas.stage.on("mousedown", clickHandler);
  });
}

// Summoning logic (separated from dialog)
async function performSummoning(selected) {
  const placedPreviews = []; // Store all previews to clean up later
  const totalCount = selected.reduce((sum, m) => sum + m.count, 0);
  let placed = 0;

  for (const { actor, count } of selected) {
    // Load texture for preview
    const tokenImg = actor.prototypeToken?.texture?.src || actor.img;
    let texture = null;
    try {
      texture = await foundry.canvas.loadTexture(tokenImg);
    } catch (e) {
      console.warn("Could not load token texture for preview:", e);
    }

    const tokenWidth = actor.prototypeToken?.width || 1;
    const tokenHeight = actor.prototypeToken?.height || 1;

    for (let i = 0; i < count; i++) {
      const pos = await waitForClick(actor.name, placed, totalCount, texture, tokenWidth, tokenHeight, placedPreviews);
      placed++;

      if (game.user.isGM) {
        // GM spawns directly
        await spawnSingleMonster(actor, pos.x, pos.y, canvas.scene?.id, null);
      } else {
        // Player requests spawn
        game.socket.emit("module.monster-summoner", {
          type: "summon",
          sourceActorId: actor.id,
          x: pos.x,
          y: pos.y,
          sceneId: canvas.scene?.id,
          summonerId: game.user.id
        });
      }
    }
  }

  // Clean up all preview sprites
  for (const preview of placedPreviews) {
    canvas.stage.removeChild(preview);
    preview.destroy();
  }
}

// Core spawning logic (executed by GM)
async function spawnSingleMonster(actor, x, y, targetSceneId = null, summonerId = null) {
  const data = foundry.utils.mergeObject(actor.toObject(), {
    name: `${actor.name} (Summoned)`,
    flags: { "monster-summoner": { temp: true } }
  });
  if (summonerId) {
    const summoner = game.users.get(summonerId);
    if (summoner && !summoner.isGM) {
      data.ownership = foundry.utils.mergeObject(data.ownership ?? {}, {
        [summonerId]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER
      });
    }
  }
  const tempActor = await Actor.create(data, { renderSheet: false });

  // Determine target scene
  const scene = targetSceneId ? game.scenes.get(targetSceneId) : canvas.scene;
  if (!scene) {
    console.warn("Monster Summoner | No target scene found for spawning.");
    return;
  }

  const baseToken = tempActor.prototypeToken.toObject();
  const w = (baseToken.width || 1) * scene.grid.size;
  const h = (baseToken.height || 1) * scene.grid.size;
  baseToken.x = x - w / 2;
  baseToken.y = y - h / 2;
  baseToken.actorId = tempActor.id;
  baseToken.actorLink = true;

  const created = await scene.createEmbeddedDocuments("Token", [baseToken]);

  // Sound and Animation
  const soundPath = game.settings.get("monster-summoner", "summonSound");
  
  if (soundPath) {
    // Play sound for everyone on the target scene
    game.socket.emit("module.monster-summoner", {
      type: "playSound",
      path: soundPath,
      sceneId: scene.id 
    });
    // Play for self (GM) if viewing the scene
    if (game.user.viewedScene === scene.id) {
      try {
         const audio = new Audio(soundPath);
         audio.volume = 0.10;
         await audio.play();
      } catch {}
    }
  }

  const anim = game.settings.get("monster-summoner", "summonAnimation");
  if (anim && typeof Sequence !== "undefined") {
    // Broadcast animation request to all clients (including self)
    // Clients will only play it if they are viewing the target scene
    game.socket.emit("module.monster-summoner", {
      type: "playAnimation",
      path: anim,
      sceneId: scene.id,
      tokenIds: created.map(d => d.id)
    });
    
    // Also handle locally for the GM if they are on the correct scene
    // (The socket emit might not be received by the sender in some Foundry versions/setups, 
    // so we call the handler directly or let the socket listener handle it if we are sure.
    // Safest is to just call the logic or emit. Foundry sockets usually don't loop back to sender.
    // So we manually invoke the logic for the GM.)
    if (game.user.viewedScene === scene.id) {
       _msPlayAnimation(anim, scene.id, created.map(d => d.id));
    }
  }
}

async function _msPlayAnimation(animPath, sceneId, tokenIds) {
  if (game.user.viewedScene !== sceneId) return;
  
  // Wait briefly for the token to be rendered on the canvas
  let attempts = 0;
  while (attempts < 10) {
    const missing = tokenIds.some(id => !canvas.tokens.get(id));
    if (!missing) break;
    await foundry.utils.sleep(50);
    attempts++;
  }

  for (const id of tokenIds) {
    const token = canvas.tokens.get(id);
    if (!token) continue;
    try {
      new Sequence()
        .effect()
        .file(animPath)
        .atLocation(token)
        .scale(1)
        .locally() // Important: Play locally since all clients on the scene do this
        .play();
    } catch(e) { console.warn("Monster Summoner | Animation error", e); }
  }
}

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

class SummonMonsterDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(monsters, subfolders, currentFolderId, breadcrumbs, selection) {
    super();
    this.monsters = monsters;
    this.subfolders = subfolders;
    this.currentFolderId = currentFolderId;
    this.breadcrumbs = breadcrumbs;
    this.selection = selection || new Map();
  }

  static DEFAULT_OPTIONS = {
    id: "summon-monster-dialog",
    tag: "form",
    window: {
      title: "MONSTER_SUMMONER.Dialog.Title",
      resizable: true
    },
    position: {
      width: 900,
      height: "auto"
    },
    classes: ["monster-summoner"],
    form: {
      handler: SummonMonsterDialog.#onFormSubmit,
      closeOnSubmit: true
    },
    actions: {
      openFolder: SummonMonsterDialog.#onOpenFolder,
      openBreadcrumb: SummonMonsterDialog.#onOpenBreadcrumb,
      backToRoot: SummonMonsterDialog.#onBackToRoot,
      addToSelection: SummonMonsterDialog.#onAddToSelection,
      removeFromSelection: SummonMonsterDialog.#onRemoveFromSelection,
      clearSelection: SummonMonsterDialog.#onClearSelection
    }
  };

  static PARTS = {
    form: {
      template: "modules/monster-summoner/templates/summon-dialog.html"
    }
  };

  async _prepareContext(options) {
    // Prepare selection list for display
    const selectionList = [];
    for (const [actorId, data] of this.selection) {
      selectionList.push({
        id: actorId,
        name: data.actor.name,
        img: data.actor.prototypeToken?.texture?.src || data.actor.img,
        count: data.count
      });
    }

    // Mark monsters that are already in selection
    const monstersWithSelection = this.monsters.map(m => ({
      ...m,
      inSelection: this.selection.has(m.id),
      selectionCount: this.selection.get(m.id)?.count || 0
    }));

    return {
      monsters: monstersWithSelection,
      subfolders: this.subfolders,
      breadcrumbs: this.breadcrumbs,
      currentFolder: this.currentFolderId ? game.folders.get(this.currentFolderId) : null,
      selection: selectionList,
      hasSelection: selectionList.length > 0,
      totalCount: selectionList.reduce((sum, s) => sum + s.count, 0),
      i18n: {
        selectType: game.i18n.localize("MONSTER_SUMMONER.Dialog.SelectType"),
        quantity: game.i18n.localize("MONSTER_SUMMONER.Dialog.Quantity"),
        back: game.i18n.localize("MONSTER_SUMMONER.Dialog.Back"),
        summon: game.i18n.localize("MONSTER_SUMMONER.Dialog.Summon"),
        selection: game.i18n.localize("MONSTER_SUMMONER.Dialog.Selection"),
        clear: game.i18n.localize("MONSTER_SUMMONER.Dialog.Clear"),
        add: game.i18n.localize("MONSTER_SUMMONER.Dialog.Add")
      }
    };
  }

  static #onOpenFolder(event, target) {
    const folderId = target.dataset.folderId;
    const clickedFolder = game.folders.get(folderId);
    let crumbIndex = this.breadcrumbs.findIndex(c => c.id === this.currentFolderId);
    const newBreadcrumbs = this.breadcrumbs.slice(0, crumbIndex + 1).concat([{ id: clickedFolder.id, name: clickedFolder.name }]);
    globalSelection = this.selection;
    this.close();
    openSummonDialog(folderId, newBreadcrumbs, this.selection);
  }

  static #onOpenBreadcrumb(event, target) {
    const folderId = target.dataset.folderId;
    let index = this.breadcrumbs.findIndex(c => c.id === folderId);
    let newBreadcrumbs = this.breadcrumbs.slice(0, index + 1);
    globalSelection = this.selection;
    this.close();
    openSummonDialog(folderId, newBreadcrumbs, this.selection);
  }

  static #onBackToRoot(event, target) {
    globalSelection = this.selection;
    this.close();
    openSummonDialog(null, [], this.selection);
  }

  static #onAddToSelection(event, target) {
    const actorId = target.dataset.actorId;
    const actor = game.actors.get(actorId);
    if (!actor) return;

    const countInput = this.element.querySelector(`input[name="count-${actorId}"]`);
    const count = parseInt(countInput?.value) || 1;

    if (count > 0) {
      if (this.selection.has(actorId)) {
        const existing = this.selection.get(actorId);
        existing.count += count;
      } else {
        this.selection.set(actorId, { actor, count });
      }
      globalSelection = this.selection;
      countInput.value = 0;
      this.render();
    }
  }

  static #onRemoveFromSelection(event, target) {
    const actorId = target.dataset.actorId;
    this.selection.delete(actorId);
    globalSelection = this.selection;
    this.render();
  }

  static #onClearSelection(event, target) {
    this.selection.clear();
    globalSelection = this.selection;
    this.render();
  }

  static async #onFormSubmit(event, form, formData) {
    // Use selection instead of form data
    const selected = [];
    for (const [actorId, data] of this.selection) {
      selected.push({ actor: data.actor, count: data.count });
    }

    if (!selected.length) {
      return ui.notifications.warn(game.i18n.localize("MONSTER_SUMMONER.Dialog.NoSelection"));
    }

    // Clear selection after summoning
    this.selection.clear();
    globalSelection = new Map();

    // Perform summoning after dialog closes
    performSummoning(selected);
  }
}
