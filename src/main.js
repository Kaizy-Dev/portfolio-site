(() => {
  'use strict';

  const documentElement = document.documentElement;
  documentElement.classList.add('js');

  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const now = () => (typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now());

  const requestFrame = typeof window.requestAnimationFrame === 'function'
    ? (callback) => window.requestAnimationFrame(callback)
    : (callback) => window.setTimeout(callback, 16);
  const cancelFrame = typeof window.cancelAnimationFrame === 'function'
    ? (frame) => window.cancelAnimationFrame(frame)
    : (frame) => window.clearTimeout(frame);

  function initReveal() {
    const revealItems = [...document.querySelectorAll('[data-reveal]')];
    if (!revealItems.length) return;

    const show = (element) => {
      const delay = Number(element.dataset.delay);
      if (reducedMotionQuery.matches) {
        element.style.transitionDelay = '0ms';
      } else if (Number.isFinite(delay) && delay > 0) {
        element.style.transitionDelay = `${delay}ms`;
      }
      element.classList.add('is-visible');
    };

    if (reducedMotionQuery.matches || !('IntersectionObserver' in window)) {
      revealItems.forEach(show);
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        show(entry.target);
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });

    revealItems.forEach((element) => observer.observe(element));

    const revealForReducedMotion = () => {
      if (!reducedMotionQuery.matches) return;
      revealItems.forEach(show);
      observer.disconnect();
    };

    if (typeof reducedMotionQuery.addEventListener === 'function') {
      reducedMotionQuery.addEventListener('change', revealForReducedMotion, { once: true });
    }
  }

  function initScrollProgress() {
    const progress = document.getElementById('scroll-progress');
    if (!progress) return;

    let frame = 0;

    const render = () => {
      frame = 0;
      if (document.visibilityState === 'hidden') return;

      const scrollableHeight = document.documentElement.scrollHeight - window.innerHeight;
      const ratio = scrollableHeight > 0
        ? Math.min(1, Math.max(0, window.scrollY / scrollableHeight))
        : 0;
      progress.style.width = `${ratio * 100}%`;
    };

    const schedule = () => {
      if (document.visibilityState === 'hidden' || frame) return;
      frame = requestFrame(render);
    };

    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        if (frame) cancelFrame(frame);
        frame = 0;
      } else {
        schedule();
      }
    });

    render();
  }

  function formatElapsed(milliseconds) {
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return [hours, minutes, seconds]
      .map((value) => String(value).padStart(2, '0'))
      .join(':');
  }

  function initClock() {
    const displays = [...document.querySelectorAll('[data-clock]')];
    if (!displays.length) return;

    const sessionStartedAt = now();
    let timer = 0;

    const elapsed = () => now() - sessionStartedAt;
    const paint = () => {
      const value = formatElapsed(elapsed());
      displays.forEach((display) => { display.textContent = value; });
    };
    const stopTimer = () => {
      if (!timer) return;
      window.clearTimeout(timer);
      timer = 0;
    };
    const schedule = () => {
      stopTimer();
      if (document.visibilityState === 'hidden') return;
      paint();
      const untilNextSecond = 1000 - (elapsed() % 1000);
      timer = window.setTimeout(schedule, Math.max(100, untilNextSecond));
    };
    const pause = () => {
      stopTimer();
    };
    const resume = () => {
      schedule();
    };

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') pause();
      else resume();
    });
    window.addEventListener('pagehide', pause);
    window.addEventListener('pageshow', resume);

    paint();
    if (document.visibilityState === 'visible') schedule();
  }

  function initMobileMenu() {
    const trigger = document.querySelector('[data-menu-trigger]');
    if (!trigger) return;

    const menuId = trigger.getAttribute('aria-controls');
    const menu = menuId ? document.getElementById(menuId) : null;
    if (!menu) return;

    const header = trigger.closest('[data-header]');
    const label = trigger.querySelector('.sr-only');
    let returnFocus = null;

    const setOpen = (open, { restoreFocus = true } = {}) => {
      trigger.setAttribute('aria-expanded', String(open));
      menu.hidden = !open;
      if (label) label.textContent = open ? 'Close menu' : 'Open menu';

      if (open) {
        returnFocus = document.activeElement;
        const firstLink = menu.querySelector('a, button, [tabindex]:not([tabindex="-1"])');
        firstLink?.focus();
      } else if (restoreFocus && returnFocus && typeof returnFocus.focus === 'function') {
        returnFocus.focus();
        returnFocus = null;
      }
    };

    const isOpen = () => trigger.getAttribute('aria-expanded') === 'true';

    trigger.addEventListener('click', () => setOpen(!isOpen()));
    menu.addEventListener('click', (event) => {
      if (event.target.closest('a')) setOpen(false);
    });

    document.addEventListener('click', (event) => {
      if (isOpen() && header && !header.contains(event.target)) setOpen(false);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && isOpen()) setOpen(false);
    });
  }

  function initCommandPalette() {
    const palette = document.getElementById('command-palette');
    if (!palette) return;

    const openButtons = [...document.querySelectorAll('[data-command-open]')];
    const closeButton = palette.querySelector('[data-command-close]');
    const commandLinks = [...palette.querySelectorAll('[data-command-link], a[role="option"]')];
    let isOpen = false;
    let returnFocus = null;

    openButtons.forEach((button) => button.setAttribute('aria-expanded', 'false'));

    const focusables = () => [closeButton, ...commandLinks]
      .filter((element) => element && !element.hidden);

    const selectLink = (index) => {
      commandLinks.forEach((link, linkIndex) => {
        link.setAttribute('aria-selected', String(linkIndex === index));
      });
    };

    const close = ({ restoreFocus = true } = {}) => {
      if (!isOpen) return;
      isOpen = false;
      palette.hidden = true;
      openButtons.forEach((button) => button.setAttribute('aria-expanded', 'false'));

      if (restoreFocus) {
        const target = returnFocus && returnFocus.isConnected && typeof returnFocus.focus === 'function'
          ? returnFocus
          : openButtons[0];
        target?.focus();
      }
      returnFocus = null;
    };

    const open = () => {
      if (isOpen) return;
      returnFocus = document.activeElement;
      isOpen = true;
      palette.hidden = false;
      openButtons.forEach((button) => button.setAttribute('aria-expanded', 'true'));
      selectLink(0);
      closeButton?.focus();
    };

    openButtons.forEach((button) => button.addEventListener('click', open));
    closeButton?.addEventListener('click', () => close());

    palette.addEventListener('click', (event) => {
      if (event.target === palette) {
        close();
        return;
      }
      if (event.target.closest('[data-command-link], a[role="option"]')) {
        window.setTimeout(() => close(), 0);
      }
    });

    document.addEventListener('keydown', (event) => {
      if (!isOpen) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
        if (!commandLinks.length) return;
        event.preventDefault();
        const currentIndex = commandLinks.indexOf(document.activeElement);
        let nextIndex;

        if (event.key === 'Home') nextIndex = 0;
        else if (event.key === 'End') nextIndex = commandLinks.length - 1;
        else if (currentIndex === -1) nextIndex = event.key === 'ArrowDown' ? 0 : commandLinks.length - 1;
        else nextIndex = (currentIndex + (event.key === 'ArrowDown' ? 1 : -1) + commandLinks.length) % commandLinks.length;

        selectLink(nextIndex);
        commandLinks[nextIndex].focus();
        return;
      }

      if (event.key === 'Tab') {
        const elements = focusables();
        if (!elements.length) {
          event.preventDefault();
          return;
        }

        const currentIndex = elements.indexOf(document.activeElement);
        if (currentIndex === -1) {
          event.preventDefault();
          elements[0].focus();
        } else if (event.shiftKey && currentIndex === 0) {
          event.preventDefault();
          elements[elements.length - 1].focus();
        } else if (!event.shiftKey && currentIndex === elements.length - 1) {
          event.preventDefault();
          elements[0].focus();
        }
      }
    });

    document.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (isOpen) close();
        else open();
      }
    });
  }

  function initRouteInstrument() {
    const instrument = document.querySelector('.hero-instrument');
    const routeMap = instrument?.querySelector('.route-map');
    const finePointer = window.matchMedia('(pointer: fine)');
    if (!instrument || !routeMap || reducedMotionQuery.matches || !finePointer.matches) return;

    let frame = 0;
    let pointerX = 0;
    let pointerY = 0;

    const reset = () => {
      if (frame) cancelFrame(frame);
      frame = 0;
      routeMap.style.transform = '';
    };

    const render = () => {
      frame = 0;
      if (document.visibilityState === 'hidden' || reducedMotionQuery.matches) return;
      const bounds = instrument.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;

      const relativeX = (pointerX - bounds.left) / bounds.width - 0.5;
      const relativeY = (pointerY - bounds.top) / bounds.height - 0.5;
      const shiftX = (-relativeX * 3).toFixed(2);
      const shiftY = (-relativeY * 3).toFixed(2);
      routeMap.style.transform = `translate3d(${shiftX}px, ${shiftY}px, 0)`;
    };

    instrument.addEventListener('pointermove', (event) => {
      if (reducedMotionQuery.matches) return;
      if (event.pointerType && event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
      pointerX = event.clientX;
      pointerY = event.clientY;
      if (!frame) frame = requestFrame(render);
    });
    instrument.addEventListener('pointerleave', reset);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') reset();
    });
    if (typeof reducedMotionQuery.addEventListener === 'function') {
      reducedMotionQuery.addEventListener('change', () => {
        if (reducedMotionQuery.matches) reset();
      });
    }

    routeMap.style.willChange = 'transform';
    routeMap.style.transition = 'transform 240ms ease-out';
  }

  initReveal();
  initScrollProgress();
  initClock();
  initMobileMenu();
  initCommandPalette();
  initRouteInstrument();
})();
