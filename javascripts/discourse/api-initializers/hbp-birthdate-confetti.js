import { apiInitializer } from "discourse/lib/api";

function sObj() {
  return typeof settings === "object" && settings ? settings : {};
}

function sInt(key, fallback) {
  const v = parseInt(sObj()[key], 10);
  return Number.isFinite(v) ? v : fallback;
}

function sFloat(key, fallback) {
  const v = parseFloat(sObj()[key]);
  return Number.isFinite(v) ? v : fallback;
}

function sBool(key, fallback) {
  const v = sObj()[key];
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.toLowerCase() === "true";
  return fallback;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function prefersReducedMotion() {
  try {
    return (
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  } catch (_) {
    return false;
  }
}

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function getHost(card) {
  return card.querySelector(".card-content") || card;
}

function ensureHostPositioning(host) {
  try {
    const cs = window.getComputedStyle(host);
    if (cs && cs.position === "static") host.style.position = "relative";
  } catch (_) {}
}

function ensureConfettiLayer(host) {
  let layer = host.querySelector(".hbp-confetti-layer");
  if (layer && layer.parentElement !== host) layer = null;

  if (!layer) {
    layer = document.createElement("div");
    layer.className = "hbp-confetti-layer";
    host.appendChild(layer);
  }

  layer.style.position = "absolute";
  layer.style.inset = "0";
  layer.style.pointerEvents = "none";
  layer.style.overflow = "hidden";
  layer.style.zIndex = "50";

  return layer;
}

function isVisibleEnough(el) {
  const r = el.getBoundingClientRect();
  if (!r || r.height === 0 || r.width === 0) return false;

  const vh = window.innerHeight || document.documentElement.clientHeight;
  const visibleTop = Math.max(r.top, 0);
  const visibleBottom = Math.min(r.bottom, vh);
  return visibleBottom - visibleTop >= 60;
}

function getAvatarNoFlyZone(host) {
  const avatar =
    host.querySelector(".avatar") ||
    host.querySelector("img.avatar") ||
    host.querySelector(".user-card-avatar") ||
    host.querySelector(".card-content .avatar");

  if (!avatar) return null;

  const hostRect = host.getBoundingClientRect();
  const a = avatar.getBoundingClientRect();

  return {
    left: a.left - hostRect.left,
    right: a.right - hostRect.left,
  };
}

function buildConfettiConfig(hostHeight) {
  const enabled = sBool("confetti_enabled", true);

  const particleCount = clamp(sInt("confetti_particle_count", 14), 0, 200);

  let durationMin = sInt("confetti_duration_min", 3500);
  let durationMax = sInt("confetti_duration_max", 6500);
  if (durationMax < durationMin) [durationMin, durationMax] = [durationMax, durationMin];

  const delayMax = clamp(sInt("confetti_delay_max", 260), 0, 20000);

  const driftX1Min = sInt("confetti_drift_x1_min", -40);
  const driftX1Max = sInt("confetti_drift_x1_max", 40);
  const driftX2Min = sInt("confetti_drift_x2_min", -70);
  const driftX2Max = sInt("confetti_drift_x2_max", 70);
  const driftX3Min = sInt("confetti_drift_x3_min", -90);
  const driftX3Max = sInt("confetti_drift_x3_max", 90);

  const rotMin = sInt("confetti_rot_min", -160);
  const rotMax = sInt("confetti_rot_max", 160);

  const jitterX = clamp(sInt("confetti_jitter_x", 10), 0, 200);
  const jitterY = clamp(sInt("confetti_jitter_y", 10), 0, 200);

  let wMin = sInt("confetti_w_min", 5);
  let wMax = sInt("confetti_w_max", 10);
  if (wMax < wMin) [wMin, wMax] = [wMax, wMin];

  let hMin = sInt("confetti_h_min", 6);
  let hMax = sInt("confetti_h_max", 14);
  if (hMax < hMin) [hMin, hMax] = [hMax, hMin];

  const roundChance = clamp(sFloat("confetti_round_chance", 0.25), 0, 1);

  const avoidAvatar = sBool("confetti_avoid_avatar", true);
  const avoidAvatarPadding = clamp(sInt("confetti_avoid_avatar_padding", 14), 0, 200);
  const avoidAvatarTries = clamp(sInt("confetti_avoid_avatar_tries", 10), 1, 100);

  // vertical fall distance: gebaseerd op card hoogte (zodat het “over de hele kaart” kan)
  const dy3Base = Math.max(140, hostHeight * rand(0.75, 1.05));

  return {
    enabled,
    particleCount,
    durationMin,
    durationMax,
    delayMax,
    driftX1Min,
    driftX1Max,
    driftX2Min,
    driftX2Max,
    driftX3Min,
    driftX3Max,
    rotMin,
    rotMax,
    jitterX,
    jitterY,
    wMin,
    wMax,
    hMin,
    hMax,
    roundChance,
    avoidAvatar,
    avoidAvatarPadding,
    avoidAvatarTries,
    dy3Base,
  };
}

function pickSpawnX(hostWidth, noFly, cfg) {
  if (!cfg.avoidAvatar || !noFly) return rand(0, hostWidth);

  const pad = cfg.avoidAvatarPadding;
  const left = Math.max(0, noFly.left - pad);
  const right = Math.min(hostWidth, noFly.right + pad);

  for (let i = 0; i < cfg.avoidAvatarTries; i++) {
    const x = rand(0, hostWidth);
    if (x < left || x > right) return x;
  }
  return rand(0, hostWidth);
}

function fireConfetti(host, iconEl) {
  if (!host || !iconEl) return;
  if (prefersReducedMotion()) return;
  if (host.dataset.hbpConfettiFired === "true") return;

  ensureHostPositioning(host);
  const layer = ensureConfettiLayer(host);

  const hostRect = host.getBoundingClientRect();
  const hostW = hostRect.width;
  const hostH = hostRect.height;

  const cfg = buildConfettiConfig(hostH);
  if (!cfg.enabled || cfg.particleCount <= 0) return;

  host.dataset.hbpConfettiFired = "true";

  const noFly = cfg.avoidAvatar ? getAvatarNoFlyZone(host) : null;

  for (let i = 0; i < cfg.particleCount; i++) {
    const p = document.createElement("span");
    p.className = `hbp-confetti hbp-confetti--${(i % 5) + 1}`;

    const originX = pickSpawnX(hostW, noFly, cfg);
    const originY = rand(-8, 10);

    const jitterX = rand(-cfg.jitterX, cfg.jitterX);
    const jitterY = rand(-cfg.jitterY, cfg.jitterY);

    const dx1 = rand(cfg.driftX1Min, cfg.driftX1Max);
    const dx2 = rand(cfg.driftX2Min, cfg.driftX2Max);
    const dx3 = rand(cfg.driftX3Min, cfg.driftX3Max);

    const dy3 = cfg.dy3Base * rand(0.85, 1.1);
    const dy2 = dy3 * rand(0.55, 0.75);
    const dy1 = dy3 * rand(0.25, 0.45);

    const rot1 = rand(cfg.rotMin, cfg.rotMax);
    const rot2 = rand(cfg.rotMin, cfg.rotMax);
    const rot3 = rand(cfg.rotMin, cfg.rotMax);

    const dur = Math.round(rand(cfg.durationMin, cfg.durationMax));
    const delay = Math.round(rand(0, cfg.delayMax));

    const w = Math.round(rand(cfg.wMin, cfg.wMax));
    const h = Math.round(rand(cfg.hMin, cfg.hMax));
    const rounded = Math.random() < cfg.roundChance ? 999 : 2;

    p.style.left = `${originX + jitterX}px`;
    p.style.top = `${originY + jitterY}px`;
    p.style.width = `${w}px`;
    p.style.height = `${h}px`;
    p.style.borderRadius = `${rounded}px`;

    p.style.setProperty("--dx1", `${dx1}px`);
    p.style.setProperty("--dx2", `${dx2}px`);
    p.style.setProperty("--dx3", `${dx3}px`);

    p.style.setProperty("--dy1", `${dy1}px`);
    p.style.setProperty("--dy2", `${dy2}px`);
    p.style.setProperty("--dy3", `${dy3}px`);

    p.style.setProperty("--rot1", `${rot1}deg`);
    p.style.setProperty("--rot2", `${rot2}deg`);
    p.style.setProperty("--rot3", `${rot3}deg`);

    p.style.setProperty("--dur", `${dur}ms`);
    p.style.setProperty("--delay", `${delay}ms`);

    layer.appendChild(p);
    setTimeout(() => p.remove(), dur + delay + 600);
  }
}

export default apiInitializer("0.11.1", (api) => {
  const pluginId = "hbp-birthdate-confetti";

  try {
    const observed = new WeakSet();

    const io =
      "IntersectionObserver" in window
        ? new IntersectionObserver(
            (entries) => {
              try {
                for (const entry of entries) {
                  const card = entry.target;
                  if (!entry.isIntersecting) continue;
                  if (entry.intersectionRatio < 0.15) continue;

                  const iconEl = card.querySelector(".hbp-birthday-icon");
                  if (!iconEl) continue;

                  const host = getHost(card);
                  fireConfetti(host, iconEl);

                  io.unobserve(card);
                }
              } catch (e) {
                console.warn(`[${pluginId}] IO callback error`, e);
              }
            },
            { threshold: [0.15] }
          )
        : null;

    const scan = () => {
      try {
        document.querySelectorAll(".user-card").forEach((card) => {
          if (observed.has(card)) return;

          const iconEl = card.querySelector(".hbp-birthday-icon");
          if (!iconEl) return;

          observed.add(card);

          const host = getHost(card);

          if (isVisibleEnough(host)) {
            requestAnimationFrame(() => {
              try {
                fireConfetti(host, iconEl);
              } catch (e) {
                console.warn(`[${pluginId}] fireConfetti error`, e);
              }
            });
            return;
          }

          if (io) io.observe(card);
        });
      } catch (e) {
        console.warn(`[${pluginId}] scan error`, e);
      }
    };

    let timer = null;
    const scheduleScan = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        scan();
      }, 80);
    };

    scheduleScan();
    api.onPageChange(() => scheduleScan());

    if ("MutationObserver" in window) {
      const startMO = () => {
        try {
          if (!document.body) return;
          const mo = new MutationObserver(() => scheduleScan());
          mo.observe(document.body, { childList: true, subtree: true });
        } catch (e) {
          console.warn(`[${pluginId}] MutationObserver error`, e);
        }
      };

      if (document.body) startMO();
      else setTimeout(startMO, 200);
    }
  } catch (e) {
    console.warn(`[${pluginId}] initializer error`, e);
  }
});
