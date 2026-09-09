/**
 * Akoya starter script file.
 * Keep lightweight behavior here as the landing page evolves.
 */
document.addEventListener('DOMContentLoaded', () => {
  const syncViewportHeight = () => {
    const viewportHeight = window.visualViewport?.height || window.innerHeight;

    if (!viewportHeight) {
      return;
    }

    document.documentElement.style.setProperty('--app-viewport-height', `${viewportHeight}px`);
  };

  const scheduleViewportHeightSync = () => {
    syncViewportHeight();
    requestAnimationFrame(syncViewportHeight);
  };

  const settleViewportHeight = () => {
    scheduleViewportHeightSync();
    [50, 150, 300, 600, 1000].forEach((delay) => {
      window.setTimeout(scheduleViewportHeightSync, delay);
    });
  };

  settleViewportHeight();
  window.addEventListener('load', settleViewportHeight, { once: true });
  window.addEventListener('pageshow', settleViewportHeight);
  window.addEventListener('resize', scheduleViewportHeightSync);
  window.addEventListener('orientationchange', settleViewportHeight);
  window.visualViewport?.addEventListener('resize', scheduleViewportHeightSync);
  window.visualViewport?.addEventListener('scroll', scheduleViewportHeightSync);

  const siteToggles = window.AKOYA_CHECKOUT_TOGGLES || {};
  const marketSegmentsSection = document.querySelector('[data-feature-toggle="marketSegments"]');
  const marketSegmentsEnabled = siteToggles.homepage?.marketSegments?.enabled !== false;

  if (marketSegmentsSection && !marketSegmentsEnabled) {
    marketSegmentsSection.hidden = true;
    marketSegmentsSection.setAttribute('aria-hidden', 'true');
  }

  document.querySelectorAll('.market-visual img').forEach((image) => {
    const collapseMissingMarketImage = () => {
      const visual = image.closest('.market-visual');
      const tile = image.closest('.market-tile');

      if (!visual || !tile) {
        return;
      }

      visual.remove();
      tile.classList.add('market-tile-text-only');
    };

    if (image.complete && image.naturalWidth === 0) {
      collapseMissingMarketImage();
      return;
    }

    image.addEventListener('error', collapseMissingMarketImage, { once: true });
  });

  const inquiryContext = document.getElementById('contactInquiryContext');

  if (inquiryContext) {
    const query = new URLSearchParams(window.location.search);
    const interest = (query.get('interest') || query.get('subject') || '').trim().toLowerCase();
    const inquirySubjects = new Map([
      ['evaluation', 'Akoya Eye Shield product evaluation'],
      ['product evaluation', 'Akoya Eye Shield product evaluation'],
      ['samples', 'Akoya Eye Shield product sample request'],
      ['product sample', 'Akoya Eye Shield product sample request'],
      ['quote', 'Akoya Eye Shield institutional quote request'],
      ['healthcare', 'Akoya Eye Shield healthcare-organization inquiry'],
    ]);

    inquiryContext.textContent = inquirySubjects.get(interest) || 'Akoya Eye Shield inquiry';
  }

  const copyText = async (value) => {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(value);
        return;
      } catch (error) {
        // Some browsers expose the Clipboard API but still deny access.
      }
    }

    const helper = document.createElement('textarea');
    helper.value = value;
    helper.setAttribute('readonly', '');
    helper.style.position = 'fixed';
    helper.style.opacity = '0';
    document.body.appendChild(helper);
    helper.select();
    const copied = document.execCommand('copy');
    helper.remove();

    if (!copied) {
      throw new Error('Copy command was unavailable');
    }
  };

  document.querySelectorAll('[data-copy-email]').forEach((button) => {
    const defaultLabel = button.textContent;
    const feedbackContainer = button.closest('.email-copy-panel, .cta-block');
    const status = feedbackContainer?.querySelector('.copy-email-status');
    let resetTimer;

    button.addEventListener('click', async () => {
      window.clearTimeout(resetTimer);

      try {
        await copyText(button.dataset.copyEmail || '');
        button.textContent = 'Email copied';
        if (status) {
          status.textContent = "Drew's email address has been copied.";
        }
      } catch (error) {
        button.textContent = defaultLabel;
        if (status) {
          status.textContent = 'Copy was unavailable. Select dzaun@akoyamedical.com on this page.';
        }
      }

      resetTimer = window.setTimeout(() => {
        button.textContent = defaultLabel;
      }, 2400);
    });
  });

  const menuToggle = document.getElementById('menuToggle');
  const mobileMenu = document.getElementById('mobileMenu');
  const mobileMenuLinks = Array.from(document.querySelectorAll('.mobile-menu a'));

  if (menuToggle && mobileMenu) {
    const setMenuState = (isOpen) => {
      mobileMenu.classList.toggle('is-open', isOpen);
      mobileMenu.setAttribute('aria-hidden', String(!isOpen));
      menuToggle.setAttribute('aria-expanded', String(isOpen));
      menuToggle.setAttribute('aria-label', isOpen ? 'Close navigation menu' : 'Open navigation menu');
    };

    menuToggle.addEventListener('click', () => {
      const isOpen = mobileMenu.classList.contains('is-open');
      setMenuState(!isOpen);
    });

    mobileMenuLinks.forEach((link) => {
      link.addEventListener('click', () => setMenuState(false));
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        setMenuState(false);
      }
    });
  }


  const productHero = document.querySelector('[data-product-hero]');

  if (productHero) {
    const slides = Array.from(productHero.querySelectorAll('[data-hero-slide]'));
    const dots = Array.from(productHero.querySelectorAll('[data-hero-dot]'));
    const pauseButton = productHero.querySelector('[data-hero-pause]');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let activeIndex = 0;
    let rotationTimer;
    let paused = reducedMotion;

    const showSlide = (nextIndex) => {
      activeIndex = (nextIndex + slides.length) % slides.length;
      slides.forEach((slide, index) => {
        const isActive = index === activeIndex;
        slide.classList.toggle('is-active', isActive);
        slide.setAttribute('aria-hidden', String(!isActive));
        slide.querySelectorAll('a, button, input, select, textarea').forEach((control) => {
          control.tabIndex = isActive ? 0 : -1;
        });
      });
      dots.forEach((dot, index) => {
        const isActive = index === activeIndex;
        dot.classList.toggle('is-active', isActive);
        if (isActive) dot.setAttribute('aria-current', 'true');
        else dot.removeAttribute('aria-current');
      });
    };

    const stopRotation = () => window.clearInterval(rotationTimer);
    const startRotation = () => {
      stopRotation();
      if (!paused && slides.length > 1) {
        rotationTimer = window.setInterval(() => showSlide(activeIndex + 1), 7000);
      }
    };

    dots.forEach((dot, index) => dot.addEventListener('click', () => {
      showSlide(index);
      startRotation();
    }));

    pauseButton?.addEventListener('click', () => {
      paused = !paused;
      pauseButton.textContent = paused ? 'Play' : 'Pause';
      pauseButton.setAttribute('aria-label', paused ? 'Play product rotation' : 'Pause product rotation');
      startRotation();
    });

    productHero.addEventListener('mouseenter', stopRotation);
    productHero.addEventListener('mouseleave', startRotation);
    productHero.addEventListener('focusin', stopRotation);
    productHero.addEventListener('focusout', (event) => {
      if (!productHero.contains(event.relatedTarget)) startRotation();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stopRotation();
      else startRotation();
    });

    if (reducedMotion && pauseButton) {
      pauseButton.textContent = 'Play';
      pauseButton.setAttribute('aria-label', 'Play product rotation');
    }
    showSlide(0);
    startRotation();
  }

  const pediatricInterestForm = document.getElementById('pediatricInterestForm');

  if (pediatricInterestForm) {
    const submitButton = pediatricInterestForm.querySelector('button[type="submit"]');
    const status = document.getElementById('pediatricInterestStatus');

    pediatricInterestForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      submitButton.disabled = true;
      status.textContent = 'Joining the launch list…';

      try {
        const response = await fetch('/api/pediatric-interest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.fromEntries(new FormData(pediatricInterestForm)))
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'Unable to submit right now.');
        pediatricInterestForm.reset();
        status.textContent = 'Thank you. You’re on the pediatric launch list, and our team will follow up as availability is confirmed.';
      } catch (error) {
        status.textContent = `${error.message} You can also email dzaun@akoyamedical.com.`;
      } finally {
        submitButton.disabled = false;
      }
    });
  }

  const galleryRoot = document.querySelector('[data-gallery]');
  const primaryImage = document.getElementById('productGalleryPrimaryImage');
  const thumbContainer = document.getElementById('productGalleryThumbs');
  const galleryMainButton = document.querySelector('.product-gallery-main');
  const lightbox = document.getElementById('productLightbox');
  const lightboxImage = lightbox?.querySelector('.lightbox-image');
  const lightboxCloseButton = lightbox?.querySelector('.lightbox-close');
  let lightboxTrigger = null;

  const closeLightbox = () => {
    if (!lightbox || !lightboxImage) {
      return;
    }

    lightbox.classList.remove('is-open');
    lightbox.setAttribute('aria-hidden', 'true');
    lightboxImage.src = '';
    lightboxImage.alt = '';
    lightboxTrigger?.focus();
  };

  if (galleryRoot && primaryImage && thumbContainer) {
    const galleryImages = [
      { src: 'assets/images/Product%20Image%201.JPG', alt: 'Front view of Akoya Eye Shield showing the opaque lower barrier and open upper viewing area' },
      { src: 'assets/images/Product%20Image%202.JPG', alt: 'Side view of Akoya Eye Shield showing the adjustable frame and lower interface' },
      { src: 'assets/images/Product%20Image%203.JPG', alt: 'Three-quarter view of Akoya Eye Shield showing the lower visual barrier' },
      { src: 'assets/images/Product%20Image%204.JPG', alt: 'Rear view of Akoya Eye Shield showing the patient-facing lower interface' },
    ];

    let activeIndex = 0;

    const openLightbox = () => {
      if (!lightbox || !lightboxImage) {
        return;
      }

      lightboxImage.src = galleryImages[activeIndex].src;
      lightboxImage.alt = galleryImages[activeIndex].alt;
      lightbox.classList.add('is-open');
      lightbox.setAttribute('aria-hidden', 'false');
      lightboxTrigger = document.activeElement;
      lightboxCloseButton?.focus();
    };

    const renderGallery = () => {
      const activeImage = galleryImages[activeIndex];
      primaryImage.src = activeImage.src;
      primaryImage.alt = activeImage.alt;

      thumbContainer.innerHTML = '';
      galleryImages
        .filter((_, index) => index !== activeIndex)
        .forEach((image, displayIndex) => {
          const actualIndex = galleryImages.findIndex((entry) => entry.src === image.src && entry.alt === image.alt);
          const thumbButton = document.createElement('button');
          thumbButton.type = 'button';
          thumbButton.className = 'product-gallery-thumb';
          thumbButton.setAttribute('aria-label', `Show product view ${displayIndex + 1}`);

          const thumbImage = document.createElement('img');
          thumbImage.src = image.src;
          thumbImage.alt = image.alt;
          thumbImage.width = 600;
          thumbImage.height = 400;
          thumbImage.loading = 'lazy';
          thumbImage.decoding = 'async';
          thumbButton.appendChild(thumbImage);

          thumbButton.addEventListener('click', () => {
            activeIndex = actualIndex;
            renderGallery();
          });

          thumbContainer.appendChild(thumbButton);
        });
    };

    galleryMainButton?.addEventListener('click', openLightbox);

    if (lightbox && lightboxCloseButton) {
      lightboxCloseButton.addEventListener('click', closeLightbox);
      lightbox.addEventListener('click', (event) => {
        if (event.target === lightbox) {
          closeLightbox();
        }
      });
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          closeLightbox();
        }
        if (event.key === 'Tab' && lightbox.classList.contains('is-open')) {
          event.preventDefault();
          lightboxCloseButton.focus();
        }
      });
    }

    renderGallery();
  }

  const buyPageQuantitySelect = document.getElementById('buyPageQuantityRequested');
  const buyPageQuantityPreview = document.getElementById('buyPageQuantityPreview');
  const buyPageCheckoutLink = document.getElementById('buyPageCheckoutLink');
  const buyPageSelectedPrice = document.getElementById('buyPageSelectedPrice');

  if (buyPageQuantitySelect && buyPageQuantityPreview && buyPageCheckoutLink) {
    const pricing = window.AKOYA_PRICING || { unitsPerBox: 12, pricePerUnitCents: 1200, formatCents: (cents) => '$' + (cents / 100).toFixed(2), getGoodsAmountCents: (boxCount) => boxCount * 12 * 1200 };
    const unitsPerBox = pricing.unitsPerBox;

    const renderBuyPageQuantityPreview = () => {
      const quantity = Number.parseInt(buyPageQuantitySelect.value, 10);
      const safeQuantity = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
      const unitCount = safeQuantity * unitsPerBox;
      const totalPriceCents = pricing.getGoodsAmountCents(safeQuantity);
      buyPageQuantityPreview.textContent = `${unitCount} units · ${pricing.formatCents(totalPriceCents)}`;
      if (buyPageSelectedPrice) {
        buyPageSelectedPrice.textContent = pricing.formatCents(pricing.pricePerUnitCents);
      }
      buyPageCheckoutLink.href = `buy-now.html?quantity=${safeQuantity}`;
    };

    buyPageQuantitySelect.addEventListener('change', renderBuyPageQuantityPreview);
    renderBuyPageQuantityPreview();
  }

  const clinicalCarousel = document.getElementById('clinicalCarousel');

  if (clinicalCarousel) {
    const clinicalSlides = Array.from(clinicalCarousel.querySelectorAll('.clinical-carousel-slide'));
    const clinicalDots = Array.from(clinicalCarousel.querySelectorAll('.clinical-carousel-dot'));
    const previousButton = clinicalCarousel.querySelector('[data-clinical-previous]');
    const nextButton = clinicalCarousel.querySelector('[data-clinical-next]');
    let clinicalIndex = 0;

    const showClinicalSlide = (nextIndex) => {
      clinicalIndex = (nextIndex + clinicalSlides.length) % clinicalSlides.length;

      clinicalSlides.forEach((slide, index) => {
        const isActive = index === clinicalIndex;
        slide.classList.toggle('is-active', isActive);
        slide.setAttribute('aria-hidden', String(!isActive));
      });

      clinicalDots.forEach((dot, index) => {
        const isActive = index === clinicalIndex;
        dot.classList.toggle('is-active', isActive);
        dot.setAttribute('aria-selected', String(isActive));
      });
    };

    previousButton?.addEventListener('click', () => showClinicalSlide(clinicalIndex - 1));
    nextButton?.addEventListener('click', () => showClinicalSlide(clinicalIndex + 1));
    clinicalDots.forEach((dot, index) => {
      dot.addEventListener('click', () => showClinicalSlide(index));
    });
  }

  const slides = Array.from(document.querySelectorAll('.carousel-slide'));
  const dots = Array.from(document.querySelectorAll('.carousel-dot'));
  const playPauseButton = document.getElementById('carouselPlayPause');

  if (!slides.length || !dots.length || !playPauseButton) {
    return;
  }

  let activeIndex = 0;
  let isPaused = false;
  let intervalId;
  const ROTATION_MS = 5000;

  const renderActiveSlide = (nextIndex) => {
    activeIndex = (nextIndex + slides.length) % slides.length;

    slides.forEach((slide, index) => {
      const isActive = index === activeIndex;
      slide.classList.toggle('is-active', isActive);
      slide.setAttribute('aria-hidden', String(!isActive));
    });

    dots.forEach((dot, index) => {
      const isActive = index === activeIndex;
      dot.classList.toggle('is-active', isActive);
      dot.setAttribute('aria-selected', String(isActive));
    });
  };

  const startRotation = () => {
    clearInterval(intervalId);
    if (isPaused) {
      return;
    }
    intervalId = setInterval(() => renderActiveSlide(activeIndex + 1), ROTATION_MS);
  };

  playPauseButton.addEventListener('click', () => {
    isPaused = !isPaused;
    playPauseButton.textContent = isPaused ? '▶' : '❚❚';
    playPauseButton.setAttribute(
      'aria-label',
      isPaused ? 'Resume automatic slide rotation' : 'Pause automatic slide rotation'
    );
    startRotation();
  });

  dots.forEach((dot, index) => {
    dot.addEventListener('click', () => {
      renderActiveSlide(index);
      startRotation();
    });
  });

  renderActiveSlide(0);
  startRotation();
});
