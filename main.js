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

  const galleryImages = Array.from(document.querySelectorAll('.product-gallery img'));
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

  if (galleryImages.length && lightbox && lightboxImage && lightboxCloseButton) {
    galleryImages.forEach((image) => {
      image.addEventListener('click', () => {
        lightboxImage.src = image.src;
        lightboxImage.alt = image.alt;
        lightbox.classList.add('is-open');
        lightbox.setAttribute('aria-hidden', 'false');
      });
    });

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
