// ==========================================================================
// FIGMA TO BLENDER — APPLICATION LOGIC (MINIMAL EDITORIAL)
// ==========================================================================

// Force scroll restoration to manual so page always reloads from the very top
if ('scrollRestoration' in history) {
  history.scrollRestoration = 'manual';
}
window.scrollTo(0, 0);

window.addEventListener('beforeunload', () => {
  window.scrollTo(0, 0);
});

// Global Lenis Smooth Scrolling Instance
let lenis = null;
if (typeof Lenis !== 'undefined') {
  lenis = new Lenis({
    duration: 1.1,
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    smoothWheel: true,
  });

  lenis.scrollTo(0, { immediate: true });

  function raf(time) {
    lenis.raf(time);
    requestAnimationFrame(raf);
  }
  requestAnimationFrame(raf);
  window.lenis = lenis;
}

document.addEventListener('DOMContentLoaded', () => {
  window.scrollTo(0, 0);
  if (window.lenis) {
    window.lenis.scrollTo(0, { immediate: true });
  }
  initHudChapterNav();
  initLiveSimulationDemo();
  initMinimalAccordion();
  initFaqAccordion();
  initVideoPlaceholderAlignment();
  initDownloadModal();
  initScrollTextReveals();
  initHappyCreatingConfetti();
});

/* ==========================================================================
   0. FLOATING HUD CHAPTER PILL & DROPDOWN NAVIGATION
   ========================================================================== */
function initHudChapterNav() {
  const wrapper = document.getElementById('hud-nav-pill');
  const trigger = document.getElementById('hud-pill-trigger');
  const dropdown = document.getElementById('hud-dropdown-menu');
  const currentNum = document.getElementById('hud-current-num');
  const currentTitle = document.getElementById('hud-current-title');
  const downloadBtn = document.getElementById('hud-menu-download');
  const downloadModal = document.getElementById('download-modal');

  if (!wrapper || !trigger || !dropdown) return;

  function toggleMenu(open) {
    const willOpen = open !== undefined ? open : !wrapper.classList.contains('open');
    if (willOpen) {
      wrapper.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
    } else {
      wrapper.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
    }
  }

  // Toggle dropdown on button click
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMenu();
  });

  // Close dropdown on outside click
  document.addEventListener('click', (e) => {
    if (!wrapper.contains(e.target)) {
      toggleMenu(false);
    }
  });

  // Close dropdown on ESC
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && wrapper.classList.contains('open')) {
      toggleMenu(false);
    }
  });

  // Handle menu item selection
  const menuItems = dropdown.querySelectorAll('.hud-menu-item');
  menuItems.forEach((item) => {
    item.addEventListener('click', (e) => {
      const href = item.getAttribute('href');
      if (href && href.startsWith('#')) {
        const target = document.querySelector(href);
        if (target) {
          e.preventDefault();
          if (window.lenis) {
            window.lenis.scrollTo(target, { offset: -20 });
          } else {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }
      }

      const num = item.getAttribute('data-num');
      const title = item.getAttribute('data-title');

      if (num && currentNum) currentNum.textContent = num;
      if (title && currentTitle) currentTitle.textContent = title;

      menuItems.forEach(i => i.classList.remove('active'));
      item.classList.add('active');

      toggleMenu(false);
    });
  });

  // Handle download item action
  if (downloadBtn && downloadModal) {
    downloadBtn.addEventListener('click', (e) => {
      e.preventDefault();
      toggleMenu(false);
      downloadModal.classList.add('active');
      document.body.style.overflow = 'hidden';
      if (window.lenis) window.lenis.stop();
    });
  }

  // Active section tracking on scroll
  const sections = [
    { id: 'hero', num: '01', title: 'Introduction' },
    { id: 'learn-more', num: '02', title: 'Learn More' },
    { id: 'faq', num: '03', title: 'FAQ' },
  ];

  // Handle Explore Features button smooth slide to accordion videos
  const exploreBtn = document.getElementById('hero-btn-explore');
  const learnMoreSection = document.getElementById('learn-more');
  if (exploreBtn && learnMoreSection) {
    exploreBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (window.lenis) {
        window.lenis.scrollTo(learnMoreSection, { offset: -20 });
      } else {
        learnMoreSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }

  function setActiveNavSection(secItem) {
    if (!secItem) return;
    if (currentNum && currentNum.textContent !== secItem.num) {
      currentNum.textContent = secItem.num;
    }
    if (currentTitle && currentTitle.textContent !== secItem.title) {
      currentTitle.textContent = secItem.title;
    }
    menuItems.forEach((item) => {
      if (item.getAttribute('data-num') === secItem.num) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });
  }

  window.addEventListener('scroll', () => {
    if (wrapper.classList.contains('open')) return;

    // Check if scrolled near bottom of page -> always lock to last section (FAQ)
    const scrollBottom = window.innerHeight + window.scrollY;
    const totalDocHeight = document.documentElement.scrollHeight;
    if (scrollBottom >= totalDocHeight - 140) {
      setActiveNavSection(sections[sections.length - 1]);
      return;
    }

    const scrollPos = window.scrollY + (window.innerHeight * 0.35);

    for (let i = sections.length - 1; i >= 0; i--) {
      const sec = document.getElementById(sections[i].id);
      if (sec) {
        const secTop = sec.getBoundingClientRect().top + window.scrollY;
        if (secTop <= scrollPos) {
          setActiveNavSection(sections[i]);
          break;
        }
      }
    }
  }, { passive: true });
}

/* ==========================================================================
   1. LIVE SIMULATION 3D DEMO (HERO SECTION)
   ========================================================================== */
function initLiveSimulationDemo() {
  const scene = document.getElementById('interactive-scene');
  const stage = document.getElementById('stage-viewport');
  const btnPush = document.getElementById('btn-push-action');
  const pushLabel = document.getElementById('push-action-label');
  const depthControl = document.getElementById('demo-depth-control');
  const subActions = document.getElementById('demo-sub-actions');
  const depthSlider = document.getElementById('layer-depth-slider');
  const depthValDisplay = document.getElementById('depth-val-display');
  const btnInspect = document.getElementById('btn-inspect-toggle');
  const inspectTooltip = document.getElementById('inspect-tooltip');
  const tooltipTitle = document.getElementById('tooltip-title');
  const tooltipDetail = document.getElementById('tooltip-detail');
  const sweepBeam = document.getElementById('cc-light-sweep-beam');

  if (!scene || !stage || !btnPush) return;

  const DEFAULT_ROTX = 39;
  const DEFAULT_ROTY = -27;
  const DEFAULT_ROTZ = 27;
  const DEFAULT_DEPTH = 54;

  // Rotation boundaries
  const MIN_Y = -52;
  const MAX_Y = 2;
  const MIN_X = 18;
  const MAX_X = 52;

  let isBlenderState = false;
  let isInspectMode = false;
  let isDragging = false;

  let rotX = DEFAULT_ROTX;
  let rotY = DEFAULT_ROTY;
  let rotZ = DEFAULT_ROTZ;

  let lastX = 0;
  let lastY = 0;
  let lastTime = 0;
  let velX = 0;
  let velY = 0;
  let physicsRafId = null;

  function updateRotation(rx, ry, rz = rotZ) {
    rotX = rx;
    rotY = ry;
    rotZ = rz;
    scene.style.setProperty('--card-rx', `${rotX}deg`);
    scene.style.setProperty('--card-ry', `${rotY}deg`);
    scene.style.setProperty('--card-rz', `${rotZ}deg`);
  }

  function stopPhysics() {
    if (physicsRafId) {
      cancelAnimationFrame(physicsRafId);
      physicsRafId = null;
    }
  }

  // 1. Reset back to flat 2D Figma View
  function resetToFigma() {
    stopPhysics();
    isDragging = false;
    isBlenderState = false;
    isInspectMode = false;

    updateRotation(DEFAULT_ROTX, DEFAULT_ROTY, DEFAULT_ROTZ);

    scene.style.transition = 'transform 0.8s cubic-bezier(0.16, 1, 0.3, 1)';
    scene.classList.remove('state-blender', 'inspect-mode');
    scene.classList.add('state-figma');

    if (pushLabel) pushLabel.textContent = 'push to blender';
    btnPush.classList.remove('is-reset');
    btnPush.style.opacity = '1';
    btnPush.style.pointerEvents = 'auto';

    if (depthControl) depthControl.classList.remove('visible');
    if (subActions) subActions.classList.remove('visible');
    if (btnInspect) btnInspect.classList.remove('active');
    if (inspectTooltip) inspectTooltip.classList.remove('visible');

    if (depthSlider) {
      depthSlider.value = DEFAULT_DEPTH;
      scene.style.setProperty('--depth', `${DEFAULT_DEPTH}px`);
      if (depthValDisplay) depthValDisplay.textContent = `${DEFAULT_DEPTH}px`;
    }
  }

  // 2. Primary Action Button Toggle (Push to Blender <-> Reset)
  btnPush.addEventListener('click', () => {
    if (isBlenderState) {
      resetToFigma();
      return;
    }

    if (pushLabel) pushLabel.textContent = 'STREAMING...';
    btnPush.style.opacity = '0.75';
    btnPush.style.pointerEvents = 'none';

    if (sweepBeam) {
      sweepBeam.classList.remove('active');
      void sweepBeam.offsetWidth; // trigger reflow
      sweepBeam.classList.add('active');
    }

    setTimeout(() => {
      isBlenderState = true;
      if (pushLabel) pushLabel.textContent = 'reset';
      btnPush.classList.add('is-reset');
      btnPush.style.opacity = '1';
      btnPush.style.pointerEvents = 'auto';

      scene.classList.remove('state-figma');
      scene.classList.add('state-blender');

      if (depthControl) depthControl.classList.add('visible');
      if (subActions) subActions.classList.add('visible');

      updateRotation(DEFAULT_ROTX, DEFAULT_ROTY, DEFAULT_ROTZ);
      scene.style.setProperty('--depth', `${DEFAULT_DEPTH}px`);
      if (depthSlider) depthSlider.value = DEFAULT_DEPTH;
      if (depthValDisplay) depthValDisplay.textContent = `${DEFAULT_DEPTH}px`;

      if (sweepBeam) sweepBeam.classList.remove('active');
    }, 600);
  });

  // 3. Smooth Flick Physics with Momentum & Boundary Elastic Overshoot
  function stepPhysics() {
    if (!isBlenderState) {
      physicsRafId = null;
      return;
    }

    const FRICTION = 0.92;
    const SPRING_K = 0.08;
    const SPRING_DAMP = 0.82;

    // Yaw physics (Y rotation)
    if (rotY < MIN_Y) {
      const disp = rotY - MIN_Y; // negative
      const force = -SPRING_K * disp;
      velY = (velY + force) * SPRING_DAMP;
    } else if (rotY > MAX_Y) {
      const disp = rotY - MAX_Y; // positive
      const force = -SPRING_K * disp;
      velY = (velY + force) * SPRING_DAMP;
    } else {
      velY *= FRICTION;
    }
    rotY += velY;

    // Pitch physics (X rotation)
    if (rotX < MIN_X) {
      const disp = rotX - MIN_X; // negative
      const force = -SPRING_K * disp;
      velX = (velX + force) * SPRING_DAMP;
    } else if (rotX > MAX_X) {
      const disp = rotX - MAX_X; // positive
      const force = -SPRING_K * disp;
      velX = (velX + force) * SPRING_DAMP;
    } else {
      velX *= FRICTION;
    }
    rotX += velX;

    updateRotation(rotX, rotY, rotZ);

    const isSettledY = Math.abs(velY) < 0.02 && (rotY >= MIN_Y - 0.2 && rotY <= MAX_Y + 0.2);
    const isSettledX = Math.abs(velX) < 0.02 && (rotX >= MIN_X - 0.2 && rotX <= MAX_X + 0.2);

    if (isSettledY && isSettledX && rotY >= MIN_Y && rotY <= MAX_Y && rotX >= MIN_X && rotX <= MAX_X) {
      physicsRafId = null;
    } else {
      physicsRafId = requestAnimationFrame(stepPhysics);
    }
  }

  // 4. Mouse Drag Orbit / Tilt in Blender Mode
  stage.addEventListener('mousedown', (e) => {
    if (!isBlenderState) return;
    if (e.target.closest('.demo-card-controls') || e.target.closest('button') || e.target.closest('input')) {
      return;
    }

    stopPhysics();
    isDragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    lastTime = performance.now();
    velX = 0;
    velY = 0;
    scene.style.transition = 'none';
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging || !isBlenderState) return;

    const now = performance.now();
    const dt = Math.max(1, now - lastTime);
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;

    // Rubber-band resistance if dragged past boundaries
    let scaleY = 0.35;
    if ((rotY < MIN_Y && dx < 0) || (rotY > MAX_Y && dx > 0)) {
      scaleY *= 0.25;
    }
    let scaleX = 0.35;
    if ((rotX < MIN_X && -dy < 0) || (rotX > MAX_X && -dy > 0)) {
      scaleX *= 0.25;
    }

    rotY += dx * scaleY;
    rotX -= dy * scaleX;

    // Filtered velocity per frame (~16ms)
    const instantVelY = (dx * scaleY / dt) * 16;
    const instantVelX = (-dy * scaleX / dt) * 16;
    velY = velY * 0.35 + instantVelY * 0.65;
    velX = velX * 0.35 + instantVelX * 0.65;

    lastX = e.clientX;
    lastY = e.clientY;
    lastTime = now;

    updateRotation(rotX, rotY, rotZ);
  });

  window.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;

    // If mouse rested before release, don't fling
    const timeSinceLastMove = performance.now() - lastTime;
    if (timeSinceLastMove > 75) {
      velX = 0;
      velY = 0;
    } else {
      // Clamp extreme flicks
      velX = Math.max(-14, Math.min(14, velX));
      velY = Math.max(-14, Math.min(14, velY));
    }

    // Launch momentum & spring bounce-back simulation
    stopPhysics();
    physicsRafId = requestAnimationFrame(stepPhysics);
  });

  // 5. Layer Depth Slider
  if (depthSlider) {
    depthSlider.addEventListener('input', (e) => {
      const val = e.target.value;
      scene.style.setProperty('--depth', `${val}px`);
      if (depthValDisplay) depthValDisplay.textContent = `${val}px`;
    });
  }

  // 6. Inspection Wireframe Mode Toggle
  if (btnInspect) {
    btnInspect.addEventListener('click', () => {
      if (!isBlenderState) return;
      isInspectMode = !isInspectMode;
      btnInspect.classList.toggle('active', isInspectMode);
      scene.classList.toggle('inspect-mode', isInspectMode);
      if (!isInspectMode && inspectTooltip) {
        inspectTooltip.classList.remove('visible');
      }
    });
  }

  // Element hover inspection
  const inspectElements = scene.querySelectorAll('[data-inspect-title]');
  inspectElements.forEach((el) => {
    el.addEventListener('mouseenter', () => {
      if (!isInspectMode || !isBlenderState || !inspectTooltip) return;
      const title = el.getAttribute('data-inspect-title') || 'LAYER NODE';
      const detail = el.getAttribute('data-inspect-detail') || '3D Primitive';
      if (tooltipTitle) tooltipTitle.textContent = title;
      if (tooltipDetail) tooltipDetail.textContent = detail;
      inspectTooltip.classList.add('visible');
    });

    el.addEventListener('mouseleave', () => {
      if (inspectTooltip && !scene.querySelector('[data-inspect-title]:hover')) {
        inspectTooltip.classList.remove('visible');
      }
    });
  });
}

/* ==========================================================================
   2. MINIMAL EDITORIAL ACCORDION & VIDEO SHOWCASE (LEARN MORE SECTION)
   ========================================================================== */
function initMinimalAccordion() {
  const accordion = document.getElementById('minimal-accordion');
  const videoElem = document.getElementById('accordion-video');
  const sweepBeam = document.getElementById('video-light-sweep-beam');
  const placeholderNotice = document.getElementById('video-placeholder-notice');
  const learnMoreSection = document.getElementById('learn-more');

  if (!accordion) return;

  const rows = accordion.querySelectorAll('.acc-row');

  // Video path mapping corresponding to each accordion index
  const ACCORDION_VIDEOS = {
    0: 'accordian videos/live sync.mp4',
    1: 'accordian videos/edit text.mp4',
    2: 'accordian videos/visual fidelity.mp4',
    3: 'accordian videos/solidify.mp4',
    4: 'accordian videos/layer heirarchy intact.mp4'
  };

  let currentVideoIndex = -1;
  let hasSweptOnce = false;

  function triggerLightSweep() {
    if (!sweepBeam || hasSweptOnce) return;
    hasSweptOnce = true;
    sweepBeam.classList.remove('active');
    void sweepBeam.offsetWidth; // Force DOM reflow to restart animation
    sweepBeam.classList.add('active');
  }

  function playAccordionVideo(index, triggerSweep = false) {
    if (!videoElem) return;

    const videoSrc = ACCORDION_VIDEOS[index];
    if (!videoSrc) {
      if (placeholderNotice) placeholderNotice.style.display = 'flex';
      return;
    }

    if (placeholderNotice) placeholderNotice.style.display = 'none';

    if (currentVideoIndex !== index) {
      currentVideoIndex = index;
      videoElem.style.opacity = '0.5';
      videoElem.src = encodeURI(videoSrc);
      videoElem.load();

      const playPromise = videoElem.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            videoElem.style.opacity = '1';
            if (triggerSweep) triggerLightSweep();
          })
          .catch(() => {
            videoElem.style.opacity = '1';
          });
      }
    } else {
      if (videoElem.paused) {
        videoElem.play().catch(() => {});
      }
      if (triggerSweep) triggerLightSweep();
    }
  }

  function updateLearnMoreDimState() {
    const hasActive = Array.from(rows).some(r => r.classList.contains('active'));
    accordion.classList.toggle('has-active', hasActive);
  }

  function setRowState(row, isOpen) {
    const symbol = row.querySelector('.acc-symbol');
    const collapse = row.querySelector('.acc-collapse');

    if (isOpen) {
      row.classList.add('active');
      if (symbol) symbol.textContent = '−';
      if (collapse) {
        collapse.style.maxHeight = `${collapse.scrollHeight}px`;
        collapse.style.opacity = '1';
      }
    } else {
      row.classList.remove('active');
      if (symbol) symbol.textContent = '+';
      if (collapse) {
        collapse.style.maxHeight = '0px';
        collapse.style.opacity = '0';
      }
    }
  }

  // Preload initial video (index 0: live sync)
  if (videoElem && ACCORDION_VIDEOS[0]) {
    videoElem.src = encodeURI(ACCORDION_VIDEOS[0]);
    videoElem.load();
  }

  // Initialize accordion row listeners
  rows.forEach((row) => {
    const isActive = row.classList.contains('active');
    setRowState(row, isActive);

    const trigger = row.querySelector('.acc-trigger');
    if (!trigger) return;

    trigger.addEventListener('click', () => {
      const willOpen = !row.classList.contains('active');
      const idx = parseInt(row.getAttribute('data-index') || '0', 10);

      if (willOpen) {
        // Close all other rows
        rows.forEach((otherRow) => {
          if (otherRow !== row) {
            setRowState(otherRow, false);
          }
        });

        // Open current row and switch video (no re-sweep on click)
        setRowState(row, true);
        playAccordionVideo(idx, false);
      }
      updateLearnMoreDimState();
    });
  });

  updateLearnMoreDimState();

  // Scroll Trigger: Automatically start active video & trigger light sweep on scroll into view
  let hasAutoplayedOnScroll = false;
  if (learnMoreSection && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const activeRow = accordion.querySelector('.acc-row.active') || rows[0];
            const activeIdx = activeRow ? parseInt(activeRow.getAttribute('data-index') || '0', 10) : 0;

            if (!hasAutoplayedOnScroll) {
              hasAutoplayedOnScroll = true;
              playAccordionVideo(activeIdx, true);
            } else if (videoElem && videoElem.paused) {
              videoElem.play().catch(() => {});
            }
          } else {
            // Pause video when section scrolls out of view
            if (videoElem && !videoElem.paused) {
              videoElem.pause();
            }
          }
        });
      },
      { threshold: 0.2 }
    );

    observer.observe(learnMoreSection);
  }
}

/* ==========================================================================
   3. VIDEO PLACEHOLDER ALIGNMENT (FIXED HEIGHT, ALIGNED TO ACCORDION)
   ========================================================================== */
function initVideoPlaceholderAlignment() {
  const accordion = document.getElementById('minimal-accordion');
  const videoFrame = document.querySelector('.video-placeholder-frame');
  if (!accordion || !videoFrame) return;

  // Measure initial natural height of the accordion with default active item
  const initialAccordionHeight = accordion.offsetHeight;
  if (initialAccordionHeight > 300) {
    // Lock the height explicitly so it strictly does NOT change when accordion items expand/collapse
    videoFrame.style.height = `${initialAccordionHeight}px`;
    videoFrame.style.minHeight = `${initialAccordionHeight}px`;
    videoFrame.style.maxHeight = `${initialAccordionHeight}px`;
  }
}

/* ==========================================================================
   4. DOWNLOAD & GET STARTED MODAL
   ========================================================================== */
function initDownloadModal() {
  const modal = document.getElementById('download-modal');
  const getStartedBtn = document.getElementById('btn-get-started');
  const heroDownloadBtn = document.getElementById('hero-btn-download');
  const closeBtn = document.getElementById('modal-close-btn');

  if (!modal) return;

  function openModal() {
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    if (window.lenis) window.lenis.stop();
  }

  function closeModal() {
    modal.classList.remove('active');
    document.body.style.overflow = '';
    if (window.lenis) window.lenis.start();
  }

  if (getStartedBtn) getStartedBtn.addEventListener('click', openModal);
  if (heroDownloadBtn) heroDownloadBtn.addEventListener('click', openModal);
  if (closeBtn) closeBtn.addEventListener('click', closeModal);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('active')) {
      closeModal();
    }
  });
}

/* ==========================================================================
   5. EDITORIAL TEXT REVEALS FROM CLIPPING MASKS (EASE OUT)
   ========================================================================== */
function initScrollTextReveals() {
  // 1. Immediately reveal hero text and 3D demo card on load with ease out
  const heroMasks = document.querySelectorAll('.hero-section .reveal-mask');
  const heroItems = document.querySelectorAll('.hero-left .reveal-item, .hero-right .reveal-item');
  setTimeout(() => {
    heroMasks.forEach(m => m.classList.add('revealed'));
    heroItems.forEach(i => i.classList.add('revealed'));
  }, 60);

  // 2. Active reveal function
  function revealElement(target) {
    if (!target) return;
    target.classList.add('revealed');
    if (target.classList.contains('reveal-mask')) {
      target.querySelectorAll('.reveal-item').forEach(i => i.classList.add('revealed'));
    } else {
      const parentMask = target.closest('.reveal-mask');
      if (parentMask) parentMask.classList.add('revealed');
    }
  }

  // 3. Scroll check fallback (ensures anything entering viewport is revealed immediately)
  function checkAllScrollReveals() {
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const pending = document.querySelectorAll('section:not(#hero) .reveal-mask:not(.revealed), section:not(#hero) .reveal-item:not(.revealed), .happy-creating-banner:not(.revealed)');
    pending.forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.top <= vh * 0.95 && rect.bottom >= 0) {
        revealElement(el);
      }
    });
  }

  // 4. Primary IntersectionObserver watching layout containers (reveal-mask)
  const allScrollTargets = document.querySelectorAll('section:not(#hero) .reveal-mask, section:not(#hero) .reveal-item, .happy-creating-banner');
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(
      (entries, obs) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting || entry.boundingClientRect.top < window.innerHeight) {
            revealElement(entry.target);
            obs.unobserve(entry.target);
          }
        });
      },
      {
        threshold: 0,
        rootMargin: '0px 0px 80px 0px'
      }
    );

    allScrollTargets.forEach((target) => observer.observe(target));
  }

  // Hook into Lenis scroll and native scroll
  window.addEventListener('scroll', checkAllScrollReveals, { passive: true });
  if (window.lenis) {
    window.lenis.on('scroll', checkAllScrollReveals);
  }

  // Initial checks
  setTimeout(checkAllScrollReveals, 100);
  setTimeout(checkAllScrollReveals, 350);
  setTimeout(checkAllScrollReveals, 800);
}

/* ==========================================================================
   7. FAQ ACCORDION INTERACTION (2-COLUMN EDITORIAL ACCORDION)
   ========================================================================== */
function initFaqAccordion() {
  const faqSection = document.getElementById('faq');
  if (!faqSection) return;

  const faqGrid = faqSection.querySelector('.faq-grid');
  const faqItems = faqSection.querySelectorAll('.faq-item');

  function updateFaqDimState() {
    const hasActive = Array.from(faqItems).some(it => it.classList.contains('active'));
    if (faqGrid) {
      faqGrid.classList.toggle('has-active', hasActive);
    }
  }

  faqItems.forEach((item) => {
    const trigger = item.querySelector('.faq-trigger');
    const symbol = item.querySelector('.faq-symbol');

    if (!trigger) return;

    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      const willOpen = !item.classList.contains('active');

      // Close all other FAQ items across both columns
      faqItems.forEach((other) => {
        if (other !== item && other.classList.contains('active')) {
          other.classList.remove('active');
          const otherSym = other.querySelector('.faq-symbol');
          if (otherSym) otherSym.textContent = '+';
        }
      });

      // Toggle this item
      if (willOpen) {
        item.classList.add('active');
        if (symbol) symbol.textContent = '−';
      } else {
        item.classList.remove('active');
        if (symbol) symbol.textContent = '+';
      }

      updateFaqDimState();
    });
  });

  updateFaqDimState();
}

/* ==========================================================================
   8. HAPPY CREATING CONFETTI (LIMITED TO BANNER DIV)
   ========================================================================== */
function initHappyCreatingConfetti() {
  const banner = document.querySelector('.happy-creating-banner');
  if (!banner) return;

  // Confined canvas strictly inside banner bounds
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti-canvas';
  canvas.style.position = 'absolute';
  canvas.style.top = '0';
  canvas.style.left = '0';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.pointerEvents = 'none';
  canvas.style.zIndex = '5';
  banner.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  let width = 0;
  let height = 0;

  function resizeCanvas() {
    width = canvas.width = banner.offsetWidth;
    height = canvas.height = banner.offsetHeight;
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  const colors = [
    '#a855f7', // Figma purple
    '#00f0ff', // Electric cyan
    '#ea580c', // Blender orange
    '#facc15', // Vibrant yellow
    '#f43f5e', // Hot pink
    '#10b981', // Emerald green
    '#ffffff', // Crisp white
    '#38bdf8'  // Sky blue
  ];

  let particles = [];
  let animId = null;

  function spawnConfetti(originX, originY) {
    const count = 80;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 0.15) + (Math.random() * Math.PI * 0.7) + (Math.random() > 0.5 ? Math.PI : 0);
      const velocity = 3.5 + Math.random() * 9.5;
      particles.push({
        x: originX,
        y: originY,
        vx: (Math.random() - 0.5) * velocity * 1.5,
        vy: -Math.abs(Math.sin(angle) * velocity) - 1.5, // initial upward thrust
        size: 5 + Math.random() * 7,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * 360,
        rotationSpeed: (Math.random() - 0.5) * 14,
        wobble: Math.random() * 10,
        wobbleSpeed: 0.08 + Math.random() * 0.12,
        alpha: 1,
        decay: 0.009 + Math.random() * 0.012,
        isRect: Math.random() > 0.35
      });
    }

    if (!animId) {
      animId = requestAnimationFrame(renderConfetti);
    }
  }

  function renderConfetti() {
    ctx.clearRect(0, 0, width, height);

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.24; // gravity
      p.vx *= 0.985; // air resistance
      p.vy *= 0.985;
      p.rotation += p.rotationSpeed;
      p.wobble += p.wobbleSpeed;
      p.alpha -= p.decay;

      // Remove particles once transparent or fallen past bottom edge
      if (p.alpha <= 0 || p.y > height + 20) {
        particles.splice(i, 1);
        continue;
      }

      ctx.save();
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rotation * Math.PI) / 180);

      const scaleX = Math.cos(p.wobble);
      ctx.scale(scaleX, 1);
      ctx.fillStyle = p.color;

      if (p.isRect) {
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 1.7);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    if (particles.length > 0) {
      animId = requestAnimationFrame(renderConfetti);
    } else {
      animId = null;
      ctx.clearRect(0, 0, width, height);
    }
  }

  banner.addEventListener('click', (e) => {
    resizeCanvas();
    const rect = banner.getBoundingClientRect();
    const x = e.clientX ? (e.clientX - rect.left) : (rect.width / 2);
    const y = e.clientY ? (e.clientY - rect.top) : (rect.height / 2);
    spawnConfetti(x, y);
  });
}
