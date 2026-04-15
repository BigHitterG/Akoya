/**
 * Akoya starter script file.
 * Keep lightweight behavior here as the landing page evolves.
 */
document.addEventListener('DOMContentLoaded', () => {
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


  const heroVideo = document.getElementById('heroVideo');

  if (heroVideo) {
    const revealVideo = () => heroVideo.classList.add('is-ready');

    if (heroVideo.readyState >= 2) {
      revealVideo();
    }

    heroVideo.addEventListener('loadeddata', revealVideo, { once: true });
    heroVideo.addEventListener('canplay', revealVideo, { once: true });

    const playbackAttempt = heroVideo.play();
    if (playbackAttempt && typeof playbackAttempt.catch === 'function') {
      playbackAttempt.catch(() => {
        // Keep the black background if autoplay is blocked.
      });
    }
  }

  const galleryRoot = document.querySelector('[data-gallery]');
  const primaryImage = document.getElementById('productGalleryPrimaryImage');
  const thumbContainer = document.getElementById('productGalleryThumbs');
  const galleryMainButton = document.querySelector('.product-gallery-main');
  const lightbox = document.getElementById('productLightbox');
  const lightboxImage = lightbox?.querySelector('.lightbox-image');
  const lightboxCloseButton = lightbox?.querySelector('.lightbox-close');

  const closeLightbox = () => {
    if (!lightbox || !lightboxImage) {
      return;
    }

    lightbox.classList.remove('is-open');
    lightbox.setAttribute('aria-hidden', 'true');
    lightboxImage.src = '';
    lightboxImage.alt = '';
  };

  if (galleryRoot && primaryImage && thumbContainer) {
    const galleryImages = [
      { src: 'assets/images/Product%20Image%201.JPG', alt: 'Akoya eyewear product image 1' },
      { src: 'assets/images/Product%20Image%202.JPG', alt: 'Akoya eyewear product image 2' },
      { src: 'assets/images/Product%20Image%203.JPG', alt: 'Akoya eyewear product image 3' },
      { src: 'assets/images/Product%20Image%204.JPG', alt: 'Akoya eyewear product image 4' },
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
          thumbButton.setAttribute('aria-label', `Show image ${displayIndex + 1}`);

          const thumbImage = document.createElement('img');
          thumbImage.src = image.src;
          thumbImage.alt = image.alt;
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
      });
    }

    renderGallery();
  }

  const buyPageQuantitySelect = document.getElementById('buyPageQuantityRequested');
  const buyPageQuantityPreview = document.getElementById('buyPageQuantityPreview');
  const buyPageCheckoutLink = document.getElementById('buyPageCheckoutLink');
  const buyPageSelectedPrice = document.getElementById('buyPageSelectedPrice');

  if (buyPageQuantitySelect && buyPageQuantityPreview && buyPageCheckoutLink) {
    const unitsPerBox = 15;
    const pricePerBox = 180;

    const renderBuyPageQuantityPreview = () => {
      const quantity = Number.parseInt(buyPageQuantitySelect.value, 10);
      const safeQuantity = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
      const unitCount = safeQuantity * unitsPerBox;
      const totalPrice = safeQuantity * pricePerBox;
      buyPageQuantityPreview.textContent = `${unitCount} units · $${totalPrice.toFixed(2)}`;
      if (buyPageSelectedPrice) {
        buyPageSelectedPrice.innerHTML = `$${totalPrice.toFixed(2)} <small>(${unitCount} units, $12.00 per unit)</small>`;
      }
      buyPageCheckoutLink.href = `buy-now.html?quantity=${safeQuantity}`;
    };

    buyPageQuantitySelect.addEventListener('change', renderBuyPageQuantityPreview);
    renderBuyPageQuantityPreview();
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
