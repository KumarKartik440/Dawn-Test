/* Figma Landing JS (vanilla)
   - Opens modal from grid
   - Fetches product by handle (/products/{handle}.js)
   - Renders options and picks matching variant
   - Adds to cart via /cart/add.js
   - Auto-add rule: if selected variant includes Color=Black and Size=Medium (case-insensitive), also add upsell product from section settings
*/
(function () {
  const rootSel = '[id^="figma-landing-"]';
  const root = document.querySelector(rootSel);
  if (!root) return;
  const sectionId = root.id.replace('figma-landing-', '');
  const cfg = (window.FIGMA_LANDING && window.FIGMA_LANDING[sectionId]) || {};

  const modal = root.querySelector('.figma-modal');
  const modalContent = modal.querySelector('.figma-modal__content');

  // Utilities
  const fetchJSON = (url, opts) => fetch(url, opts).then((r) => {
    if (!r.ok) throw new Error('Network');
    return r.json();
  });
  const escapeHTML = (s) => (s || '').replace(/[&<>'"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','\'':'&#39;','"':'&quot;'}[c]));

  const money = (cents, currency = Shopify && Shopify.currency && Shopify.currency.active) => {
    const value = (cents || 0) / 100;
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value); } catch { return value.toFixed(2); }
  };

  // State
  let currentProduct = null;
  let selectedOptions = {};
  let selectedVariant = null;

  function openModal() {
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }
  function closeModal() {
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    modalContent.innerHTML = '';
    currentProduct = null;
    selectedOptions = {};
    selectedVariant = null;
  }

  modal.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) closeModal();
  });

  // Open product from grid
  root.querySelectorAll('.js-open-product').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const handle = btn.getAttribute('data-product-handle');
      if (!handle) return;
      try {
        const product = await fetchJSON(`/products/${handle}.js`);
        currentProduct = product;
        renderModal(product);
        openModal();
      } catch (err) {
        console.error('Failed to load product', err);
      }
    });
  });

  function renderModal(product) {
    const firstImage = product.images && product.images[0];
    const price = product.price || (product.variants && product.variants[0] && product.variants[0].price) || 0;
    const desc = product.description || '';

    // Build options UI
    const optionsHTML = (product.options || []).map((opt, i) => {
      const name = opt.name; // Color, Size, etc.
      const values = opt.values || [];
      const id = `opt-${i}`;
      const isSwatch = /color/i.test(name);
      const lower = String(name || '').toLowerCase();
      const labelText = lower.includes('color')
        ? (cfg.chooseColorText || name)
        : lower.includes('size')
        ? (cfg.chooseSizeText || name)
        : name;
      return `
        <div class="figma-opt">
          <label class="figma-opt__label">${escapeHTML(labelText)}</label>
          <div class="figma-opt__values ${isSwatch ? 'figma-opt__values--swatch' : ''}" data-option-index="${i}" data-option-name="${escapeHTML(name)}">
            ${values.map((v) => `<button type="button" class="figma-opt__btn" data-value="${escapeHTML(v)}">${escapeHTML(v)}</button>`).join('')}
          </div>
        </div>`;
    }).join('');

    const html = `
      <div class="figma-modal__left">
        ${firstImage ? `<img src="${firstImage}" alt="${escapeHTML(product.title)}">` : ''}
      </div>
      <div class="figma-modal__right">
        <h3 class="figma-modal__title">${escapeHTML(product.title)}</h3>
        <div class="figma-modal__price">${money(price)}</div>
        <div class="figma-modal__desc">${desc}</div>
        ${optionsHTML}
        <button class="button button--primary figma-add" type="button">${escapeHTML(cfg.addToCartText || 'Add to cart')}</button>
      </div>`;

    modalContent.innerHTML = html;

    // Selection logic
    modalContent.querySelectorAll('.figma-opt__values').forEach((wrap) => {
      wrap.addEventListener('click', (e) => {
        const btn = e.target.closest('.figma-opt__btn');
        if (!btn) return;
        wrap.querySelectorAll('.figma-opt__btn').forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        const idx = parseInt(wrap.getAttribute('data-option-index'), 10);
        selectedOptions[idx] = btn.getAttribute('data-value');
        resolveVariant();
      });
    });

    const addBtn = modalContent.querySelector('.figma-add');
    addBtn.addEventListener('click', onAddToCart);

    // Preselect first available combination
    (product.options || []).forEach((opt, i) => {
      const first = modalContent.querySelector(`.figma-opt__values[data-option-index="${i}"] .figma-opt__btn`);
      if (first) first.click();
    });
  }

  function resolveVariant() {
    if (!currentProduct) return;
    const opts = currentProduct.options || [];
    if (Object.keys(selectedOptions).length < opts.length) { selectedVariant = null; return; }
    const wanted = opts.map((_, i) => selectedOptions[i]);
    selectedVariant = currentProduct.variants.find((v) => {
      const arr = [v.option1, v.option2, v.option3].filter(Boolean);
      return wanted.every((val, i) => !val || val === arr[i]);
    }) || null;
  }

  async function addLine(variantId, qty = 1) {
    return fetchJSON('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ items: [{ id: variantId, quantity: qty }] })
    });
  }

  async function onAddToCart() {
    try {
      if (!selectedVariant) resolveVariant();
      const variant = selectedVariant || (currentProduct && currentProduct.variants && currentProduct.variants[0]);
      if (!variant) return;
      // Add main item
      await addLine(variant.id, 1);

      // Auto-add rule: if options contain Black AND Medium
      const values = [variant.option1, variant.option2, variant.option3].map((v)=>String(v||'').toLowerCase());
      if (values.includes('black') && values.includes('medium') && cfg.upsellHandle) {
        try {
          const upsell = await fetchJSON(`/products/${cfg.upsellHandle}.js`);
          const upsellVariant = upsell.variants.find(v => v.available) || upsell.variants[0];
          if (upsellVariant) await addLine(upsellVariant.id, 1);
        } catch (e) { console.warn('Upsell fetch failed', e); }
      }

      // Open drawer if available, else reload count
      const drawerToggle = document.querySelector('[data-cart-drawer-toggle]');
      if (drawerToggle) drawerToggle.click();
      closeModal();
    } catch (err) {
      console.error('Add to cart failed', err);
    }
  }
})();
