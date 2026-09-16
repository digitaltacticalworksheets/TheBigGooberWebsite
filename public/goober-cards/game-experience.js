/*
 * Goober Cards: animation and interaction layer.
 * This intentionally wraps the existing game functions so solo and online
 * battles continue to share the same rules and server messages.
 */
(function enhanceGooberCards() {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const roleIcons = {
    Tank: '🛡️',
    Brawler: '💥',
    'Glass Cannon': '🔥',
    Trickster: '🌀',
    Healer: '💚',
    Balanced: '⭐'
  };
  const actionIcons = {
    attack: '⚔️',
    defend: '🛡️',
    charge: '⚡',
    trick: '💨',
    swap: '🔁',
    locked: '🔒'
  };

  const safeAttr = value => esc(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const slug = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const wait = milliseconds => new Promise(resolve => window.setTimeout(resolve, milliseconds));

  cardHTML = function animatedCardHTML(goober, label, outcome = '', momentum = 0, action = null) {
    const g = withHp(goober);
    const cardStats = stats(g);
    const healthPercent = Math.max(0, Math.min(100, Math.round(g.hp / g.maxHp * 100)));
    const selected = S.selectedStat;
    const rollValue = selected && cardStats[selected] ? cardStats[selected] : selected === 'Ultimate' ? 'ULT' : '—';
    const cardRarity = rarity(g);
    const encodedId = encodeURIComponent(g.id || g.name || 'goober');
    const actionName = action ? labelAction(action) : 'Waiting';
    const actionIcon = actionIcons[action] || '🎲';
    const typeIcon = typeIcons[g.type] || '❓';

    return `
      <article class="card rarity-${slug(cardRarity)} ${outcome}" data-card-id="${safeAttr(g.id || g.name)}" aria-label="${safeAttr(g.name)} battle card">
        <div class="card-topline">
          <span class="role-crest" title="${safeAttr(g.role)}">${roleIcons[g.role] || '⭐'}</span>
          <div class="card-title">
            <h3>${esc(g.name)}</h3>
            <small>${esc(label)} · ${typeIcon} ${esc(g.type)}</small>
          </div>
          <span class="momentum-gem" title="${Number(momentum) || 0} momentum"><b>⚡${Number(momentum) || 0}</b></span>
        </div>
        <div class="art">
          <img src="${safeAttr(g.imageUrl || '/assets/original-goober.jpg')}" alt="${safeAttr(g.name)}">
          <span class="rarity-ribbon">${esc(cardRarity)}</span>
          <span class="action-rune" data-action="${safeAttr(action || 'waiting')}" title="${safeAttr(actionName)}">${actionIcon}</span>
        </div>
        <div class="info">
          <div class="ability-copy">
            <strong>${esc(g.specialMove)}</strong>
            ${esc(g.role)} · ${esc(ultimateLabel(g))}
          </div>
          <div class="card-meter">
            <span>HP</span>
            <div class="hpbar" aria-label="${Math.round(g.hp)} of ${g.maxHp} health"><span style="width:${healthPercent}%"></span></div>
            <span>${Math.round(g.hp)}/${g.maxHp}</span>
          </div>
          <div class="stat-orbs">
            <span class="stat-orb attack" title="Attack ${cardStats.Attack}">⚔ ${cardStats.Attack}</span>
            <span class="roll-orb" title="Current battle stat">${selected ? dieFaces[selected] || '🎲' : '🎲'} <b>${selected ? esc(selected) : 'ROLL'} ${rollValue}</b></span>
            <span class="stat-orb health" title="Health ${Math.round(g.hp)}">♥ ${Math.round(g.hp)}</span>
          </div>
          <button class="detailsBtn" type="button" data-stats-card="${safeAttr(encodedId)}" aria-label="View ${safeAttr(g.name)} stats">Stats</button>
        </div>
      </article>`;
  };

  mini = function animatedMini(goober, isActive, disabled, onSelect, switchable = false) {
    const g = withHp(goober);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `mini${isActive ? ' active' : ''}${switchable && !isActive ? ' switchable' : ''}${g.hp <= 0 ? ' ko' : ''}`;
    button.disabled = disabled;
    button.setAttribute('aria-label', `${g.name}, ${g.hp <= 0 ? 'knocked out' : isActive ? 'active card' : switchable ? 'available to swap' : g.role}`);
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    button.innerHTML = `
      <img src="${safeAttr(g.imageUrl || '/assets/original-goober.jpg')}" alt="">
      <span class="mini-hp">${Math.round(g.hp)}</span>
      <span>
        <strong>${esc(g.name)}</strong>
        <small>${g.hp <= 0 ? 'Knocked out' : g.ultimatePending ? 'Ultimate charged' : isActive ? 'In play' : switchable ? 'Tap to swap' : `${typeIcons[g.type] || '❓'} ${g.role}`}</small>
      </span>`;
    if (onSelect) button.onclick = onSelect;
    return button;
  };

  function ensureEffectsLayer() {
    const board = document.querySelector('.board');
    if (!board) return null;

    let layer = board.querySelector('.effects-layer');
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'effects-layer';
      layer.id = 'effectsLayer';
      layer.setAttribute('aria-hidden', 'true');
      layer.innerHTML = '<div class="combat-banner" id="combatBanner"></div>';
      board.appendChild(layer);
    }
    return layer;
  }

  function moveBattleButton() {
    const dieBox = document.querySelector('.diebox');
    const actionPanel = document.querySelector('.action-panel');
    if (!dieBox || !actionPanel || !E.attack) return;
    if (E.attack.parentElement !== dieBox) actionPanel.insertAdjacentElement('afterend', E.attack);
    E.attack.classList.add('battle-button');
  }

  function updateSoundButton() {
    E.sound.textContent = `Sound: ${audioEnabled ? 'On' : 'Off'}`;
    E.sound.setAttribute('aria-pressed', audioEnabled ? 'true' : 'false');
    E.sound.title = audioEnabled ? 'Turn battle sounds off' : 'Turn battle sounds on';
  }

  function updateThemeButton() {
    const themeButton = $('themeToggle');
    if (!themeButton) return;
    const dark = document.body.classList.contains('dark-game');
    themeButton.textContent = dark ? '☀️ Light Board' : '🌙 Dark Board';
    themeButton.setAttribute('aria-pressed', dark ? 'true' : 'false');
  }

  setAudio = function setAnimatedAudio(on) {
    audioEnabled = Boolean(on);
    updateSoundButton();
    if (audioEnabled) playSound('ready');
  };

  function bindStatsButtons() {
    document.querySelectorAll('[data-stats-card]').forEach(button => {
      if (button.dataset.boundStats === 'true') return;
      button.dataset.boundStats = 'true';
      button.addEventListener('click', () => showStats(button.dataset.statsCard));
    });
  }

  function fanHands(deal = false) {
    document.querySelectorAll('.hand').forEach(hand => {
      const cards = [...hand.querySelectorAll('.mini')];
      const midpoint = (cards.length - 1) / 2;
      cards.forEach((card, index) => {
        const offset = index - midpoint;
        card.style.setProperty('--fan-angle', `${offset * 4.5}deg`);
        card.style.setProperty('--fan-lift', `${Math.abs(offset) * 2}px`);
        if (deal) {
          card.style.setProperty('--deal-delay', `${index * 85 + (hand === E.p1Hand ? 100 : 0)}ms`);
          card.classList.add('deal-mini');
        }
      });
    });
  }

  function bindCardTilt() {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches || prefersReducedMotion.matches) return;
    document.querySelectorAll('.card').forEach(card => {
      if (card.dataset.tiltBound === 'true') return;
      card.dataset.tiltBound = 'true';
      card.addEventListener('pointermove', event => {
        if (card.classList.contains('strike-left') || card.classList.contains('strike-right') || card.classList.contains('hit-card')) return;
        const rect = card.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width - 0.5;
        const y = (event.clientY - rect.top) / rect.height - 0.5;
        card.style.transform = `rotateX(${-y * 8}deg) rotateY(${x * 10}deg) translateY(-5px)`;
      });
      card.addEventListener('pointerleave', () => {
        card.style.transform = '';
      });
    });
  }

  function afterRender(event = null) {
    moveBattleButton();
    ensureEffectsLayer();
    bindStatsButtons();
    bindCardTilt();
    updateSoundButton();
    updateThemeButton();

    E.battleResult.setAttribute('role', 'status');
    E.battleResult.setAttribute('aria-live', 'polite');
    E.attack.setAttribute('aria-busy', document.body.classList.contains('is-resolving') ? 'true' : 'false');

    document.querySelectorAll('.actionBtn').forEach(button => {
      button.setAttribute('aria-pressed', button.classList.contains('selected') ? 'true' : 'false');
      const descriptions = {
        attack: 'Deal extra damage',
        defend: 'Reduce damage and improve dodge',
        charge: 'Gain momentum and improve special chance',
        trick: 'Improve dodge and battle score',
        swap: 'Change Goobers with some protection'
      };
      button.title = descriptions[button.dataset.action] || '';
    });

    if (event?.type === 'deal') {
      document.querySelectorAll('.slot .card').forEach((card, index) => {
        card.style.animationDelay = `${index * 120}ms`;
        card.classList.add('deal-in');
      });
      fanHands(true);
    } else {
      fanHands(false);
      if (event?.type === 'swap') {
        const mount = event.side === 'p1' ? E.p1Mount : E.p2Mount;
        mount?.querySelector('.card')?.classList.add('swap-in');
      }
    }
  }

  function playerSnapshot(player, fallbackCard) {
    const card = player?.card || fallbackCard || null;
    return {
      id: card?.id || card?.name || '',
      name: card?.name || '',
      hp: Number(card?.hp || 0),
      maxHp: Number(card?.maxHp || 0)
    };
  }

  function gameSnapshot() {
    if (S.online) {
      const p1 = S.room?.players?.p1;
      const p2 = S.room?.players?.p2;
      return {
        mode: 'online',
        round: Number(S.room?.round || S.round || 0),
        p1: playerSnapshot(p1),
        p2: playerSnapshot(p2),
        winner: S.room?.lastWinner || S.lastWinner || '',
        damage: Number(S.room?.lastDamage || 0),
        result: String(S.room?.lastResult || ''),
        lastEvent: String(S.room?.lastEvent || ''),
        knockout: Boolean(S.room?.knockout)
      };
    }

    const latestLog = S.soloLog?.[0] || {};
    return {
      mode: 'solo',
      round: Number(S.round || 0),
      p1: playerSnapshot(null, active()),
      p2: playerSnapshot(null, enemy()),
      winner: S.lastWinner || '',
      damage: Number(latestLog.damage || 0),
      result: String(latestLog.text || E.battleResult?.textContent || ''),
      lastEvent: '',
      knockout: Boolean(S.knockout)
    };
  }

  function deriveRenderEvent(previous, next) {
    if (!next) return null;
    const hasCards = Boolean(next.p1.id || next.p2.id);
    if (!previous && hasCards) return { type: 'deal' };

    if (previous && next.round > previous.round && hasCards) {
      const winner = next.winner;
      const resultLower = next.result.toLowerCase();
      const p1WonRoll = previous.p1.name && resultLower.includes(`${previous.p1.name.toLowerCase()} won`);
      const p2WonRoll = previous.p2.name && resultLower.includes(`${previous.p2.name.toLowerCase()} won`);
      const attacker = p1WonRoll
        ? 'p1'
        : p2WonRoll
          ? 'p2'
          : winner === 'player' || winner === 'p1'
            ? 'p1'
            : winner === 'opponent' || winner === 'p2'
              ? 'p2'
              : 'p1';
      const defender = attacker === 'p1' ? 'p2' : 'p1';
      const lowerResult = resultLower;
      const knockout = previous[defender].id !== next[defender].id || /knocked out|knockout/.test(lowerResult);
      return {
        type: 'combat',
        attacker,
        defender,
        damage: next.damage,
        dodge: next.damage <= 0 || /dodge/.test(lowerResult) || next.lastEvent === 'dodge',
        critical: /critical/.test(lowerResult) || next.lastEvent === 'crit',
        special: /special/.test(lowerResult) || next.lastEvent === 'special',
        ultimate: /ultimate/.test(lowerResult) || next.lastEvent === 'ultimate',
        healed: /healed|restored|❤️/.test(next.result),
        knockout,
        stat: S.selectedStat || S.room?.selectedStat || '',
        result: next.result
      };
    }

    if (previous && hasCards && (next.round < previous.round || (!previous.p1.id && next.p1.id) || (!previous.p2.id && next.p2.id))) {
      return { type: 'deal' };
    }

    if (previous && next.round === previous.round) {
      if (previous.p1.id && next.p1.id && previous.p1.id !== next.p1.id) return { type: 'swap', side: 'p1' };
      if (previous.p2.id && next.p2.id && previous.p2.id !== next.p2.id) return { type: 'swap', side: 'p2' };
    }

    return null;
  }

  function localCenter(element, boardRect) {
    const rect = element.getBoundingClientRect();
    return {
      x: rect.left - boardRect.left + rect.width / 2,
      y: rect.top - boardRect.top + rect.height / 2
    };
  }

  function showCombatBanner(text, ultimate = false) {
    const layer = ensureEffectsLayer();
    const banner = layer?.querySelector('.combat-banner');
    if (!banner) return;
    banner.textContent = text;
    banner.className = `combat-banner${ultimate ? ' ultimate' : ''}`;
    void banner.offsetWidth;
    banner.classList.add('show');
  }

  function launchProjectile(layer, start, end, ultimate) {
    const projectile = document.createElement('span');
    projectile.className = `fx-projectile${ultimate ? ' ultimate' : ''}`;
    projectile.style.left = `${start.x}px`;
    projectile.style.top = `${start.y}px`;
    layer.appendChild(projectile);
    void projectile.offsetWidth;
    projectile.classList.add('fly');
    projectile.style.transform = `translate(${end.x - start.x}px, ${end.y - start.y}px) scale(${ultimate ? 1.35 : 1}) rotate(260deg)`;
    window.setTimeout(() => projectile.remove(), 520);
  }

  function spawnSparks(layer, point, ultimate = false) {
    const colors = ultimate ? ['#f7c8ff', '#c66cff', '#ffffff', '#7fe8ff'] : ['#fff4a5', '#ffc23d', '#ff6c3d', '#ffffff'];
    const count = ultimate ? 24 : 16;
    for (let index = 0; index < count; index += 1) {
      const spark = document.createElement('span');
      const angle = Math.PI * 2 * index / count + Math.random() * 0.3;
      const distance = 34 + Math.random() * (ultimate ? 95 : 65);
      spark.className = 'spark';
      spark.style.left = `${point.x}px`;
      spark.style.top = `${point.y}px`;
      spark.style.setProperty('--spark-x', `${Math.cos(angle) * distance}px`);
      spark.style.setProperty('--spark-y', `${Math.sin(angle) * distance}px`);
      spark.style.setProperty('--spark-size', `${5 + Math.random() * 9}px`);
      spark.style.setProperty('--spark-color', colors[index % colors.length]);
      layer.appendChild(spark);
      window.setTimeout(() => spark.remove(), 720);
    }
  }

  function floatingText(layer, point, text, className = '') {
    const pop = document.createElement('span');
    pop.className = `damage-pop ${className}`.trim();
    pop.textContent = text;
    pop.style.left = `${point.x}px`;
    pop.style.top = `${point.y}px`;
    layer.appendChild(pop);
    window.setTimeout(() => pop.remove(), 1150);
  }

  async function playCombatPrelude(event) {
    const board = document.querySelector('.board');
    const layer = ensureEffectsLayer();
    const attackerMount = event.attacker === 'p1' ? E.p1Mount : E.p2Mount;
    const defenderMount = event.defender === 'p1' ? E.p1Mount : E.p2Mount;
    const attackerCard = attackerMount?.querySelector('.card');
    const defenderCard = defenderMount?.querySelector('.card');
    if (!board || !layer || !attackerCard || !defenderCard) return null;

    const boardRect = board.getBoundingClientRect();
    const start = localCenter(attackerCard, boardRect);
    const end = localCenter(defenderCard, boardRect);
    const bannerText = event.ultimate
      ? '✨ ULTIMATE!'
      : event.critical
        ? '💥 CRITICAL!'
        : event.special
          ? '✨ SPECIAL!'
          : event.stat
            ? `${dieFaces[event.stat] || '⚔️'} ${event.stat}`
            : '⚔️ BATTLE!';

    document.body.classList.add('is-resolving');
    E.attack.disabled = true;
    E.attack.setAttribute('aria-busy', 'true');
    showCombatBanner(bannerText, event.ultimate);
    attackerCard.classList.add(event.attacker === 'p1' ? 'strike-left' : 'strike-right');
    launchProjectile(layer, start, end, event.ultimate);

    window.setTimeout(() => {
      if (event.dodge) {
        defenderCard.classList.add(event.defender === 'p1' ? 'dodge-right' : 'dodge-left');
      } else {
        defenderCard.classList.add(event.knockout ? 'knockout-card' : 'hit-card');
        board.classList.remove('impact');
        void board.offsetWidth;
        board.classList.add('impact');
        spawnSparks(layer, end, event.ultimate);
      }
    }, event.ultimate ? 300 : 245);

    await wait(event.knockout ? 720 : event.ultimate ? 670 : 540);
    return { hitPoint: end, attackerPoint: start };
  }

  function playCombatAftermath(event, points) {
    const layer = ensureEffectsLayer();
    if (!layer || !points) return;
    if (event.dodge) {
      floatingText(layer, points.hitPoint, 'DODGE!', 'dodge');
    } else {
      floatingText(layer, points.hitPoint, `−${event.damage}`, event.knockout ? 'ko' : '');
      if (event.knockout) window.setTimeout(() => showCombatBanner('☠️ KNOCKOUT!', false), 190);
    }
    if (event.healed) floatingText(layer, points.attackerPoint, '+HP', 'dodge');
  }

  const originalRender = render;
  let previousSnapshot = null;
  let animationRunning = false;
  let queuedRender = false;

  render = function animatedRender(...args) {
    const nextSnapshot = gameSnapshot();
    const event = deriveRenderEvent(previousSnapshot, nextSnapshot);

    if (animationRunning) {
      queuedRender = true;
      return;
    }

    const canAnimateCombat = event?.type === 'combat'
      && !prefersReducedMotion.matches
      && Boolean(document.querySelector('.slot .card'));

    if (!canAnimateCombat) {
      originalRender.apply(this, args);
      window.requestAnimationFrame(() => afterRender(event));
      previousSnapshot = gameSnapshot();
      return;
    }

    animationRunning = true;
    playCombatPrelude(event).then(points => {
      originalRender.apply(this, args);
      window.requestAnimationFrame(() => {
        afterRender();
        playCombatAftermath(event, points);
      });
      previousSnapshot = gameSnapshot();
      window.setTimeout(() => {
        document.body.classList.remove('is-resolving');
        E.attack.setAttribute('aria-busy', 'false');
        animationRunning = false;
        if (queuedRender) {
          queuedRender = false;
          originalRender();
          window.requestAnimationFrame(() => afterRender());
          previousSnapshot = gameSnapshot();
        }
      }, event.ultimate ? 760 : 620);
    });
  };

  $('themeToggle')?.addEventListener('click', () => window.requestAnimationFrame(updateThemeButton));
  window.addEventListener('resize', () => fanHands(false), { passive: true });

  moveBattleButton();
  ensureEffectsLayer();
  updateSoundButton();
  updateThemeButton();
  if (S.team.length || S.room?.players) render();
  else afterRender();
})();
