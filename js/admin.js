/**
 * ==========================================================================
 * منطق پنل مدیریت سامانه پویش (Admin Panel Logic)
 * عملیات کامل مدیریت پویش‌ها، پرداخت‌ها، فیلترها و تنظیمات
 * ==========================================================================
 */

let allCampaigns = [];
let allPayments = [];
let allNotifications = [];
let allAdmins = [];
let currentSmsSettings = null;
let allSmsLogs = [];
let activeSection = 'dashboard';
let activeNotifCategory = 'users';
let editingCampaignId = null;
let editingPaymentId = null;
let activeDatepickerInput = null;

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
window.escapeHtml = escapeHtml;

let paymentFilters = {
  status: 'all',
  minAmount: null,
  maxAmount: null,
  name: '',
  tracking: '',
  phone: ''
};

let userFilters = {
  search: '',
  anonymous: 'all',
  from_date: '',
  to_date: '',
  page: 1,
  limit: 10
};

let logFilters = {
  search: '',
  action_type: 'all',
  actor: 'all',
  from_date: '',
  to_date: '',
  page: 1,
  limit: 15
};

let termsInitialContent = '';
let termsIsDirty = false;

function formatAdminRelativeTime(dateStr) {
  if (!dateStr) return 'به تازگی';
  try {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffMin < 1) return 'هم‌اکنون';
    if (diffMin < 60) return `${window.CampaignDB.toPersianDigits(diffMin)} دقیقه پیش`;
    if (diffHour < 24) return `${window.CampaignDB.toPersianDigits(diffHour)} ساعت پیش`;
    if (diffDay < 30) return `${window.CampaignDB.toPersianDigits(diffDay)} روز پیش`;
    return window.CampaignDB.toPersianDigits(new Date(dateStr).toLocaleDateString('fa-IR'));
  } catch (e) {
    return 'به تازگی';
  }
}

function getAdminNotifLocalReadState() {
  let lastReadAllTime = 0;
  try {
    const storedTime = localStorage.getItem('ADMIN_NOTIFS_LAST_READ_ALL_TIME');
    if (storedTime) lastReadAllTime = parseInt(storedTime, 10) || 0;
  } catch (e) {}

  let readIds = new Set();
  try {
    const storedIds = localStorage.getItem('ADMIN_NOTIFS_READ_IDS');
    if (storedIds) {
      const arr = JSON.parse(storedIds);
      if (Array.isArray(arr)) readIds = new Set(arr);
    }
  } catch (e) {}

  return { lastReadAllTime, readIds };
}

function markAdminNotifLocalRead(id) {
  try {
    const storedIds = localStorage.getItem('ADMIN_NOTIFS_READ_IDS');
    let arr = [];
    if (storedIds) {
      const parsed = JSON.parse(storedIds);
      if (Array.isArray(parsed)) arr = parsed;
    }
    if (id && !arr.includes(id)) {
      arr.push(id);
      localStorage.setItem('ADMIN_NOTIFS_READ_IDS', JSON.stringify(arr));
    }
  } catch (e) {}
}

function markAllAdminNotifsLocalRead(notificationsList) {
  try {
    const now = Date.now();
    localStorage.setItem('ADMIN_NOTIFS_LAST_READ_ALL_TIME', String(now));
    const ids = Array.isArray(notificationsList) ? notificationsList.map(n => n.id).filter(Boolean) : [];
    localStorage.setItem('ADMIN_NOTIFS_READ_IDS', JSON.stringify(ids));
  } catch (e) {}
}

async function reloadNotifications() {
  try {
    if (typeof window.CampaignDB.getNotifications === 'function') {
      const data = await window.CampaignDB.getNotifications();
      const rawList = Array.isArray(data.notifications) ? data.notifications : [];
      const { lastReadAllTime, readIds } = getAdminNotifLocalReadState();

      // اعلان تنها در صورتی جدید/خوانده‌نشده است که بعد از زمان آخرین «خوانده شدن همه» ثبت شده باشد و تکی هم خوانده نشده باشد
      allNotifications = rawList.map(n => {
        if (!n) return n;
        const createdMs = n.created_at ? new Date(n.created_at).getTime() : 0;
        const isLocallyRead = (lastReadAllTime > 0 && createdMs <= lastReadAllTime) || readIds.has(n.id);
        if (isLocallyRead) {
          return { ...n, is_read: true };
        }
        return n;
      });

      const actualUnreadCount = allNotifications.filter(n => !n.is_read).length;
      renderNotificationsDropdown(actualUnreadCount);
    }
  } catch (err) {
    console.warn('خطا در دریافت اعلان‌های مدیریت:', err);
  }
}

function getNotificationCategory(n) {
  if (!n) return 'site';
  if (n.category === 'users' || n.category === 'admin' || n.category === 'site') {
    return n.category;
  }
  const type = String(n.type || '').toLowerCase();
  if (type.includes('user') || type === 'user_approval' || type === 'user_visibility' || type === 'user_status') {
    return 'users';
  }
  if (type.includes('terms') || type.includes('setting') || type.includes('gateway') || type.includes('admin') || type.includes('system') || type === 'campaign_status' || type.includes('log') || type.includes('backup') || type.includes('auth')) {
    return 'admin';
  }
  if (type.includes('pay') || type.includes('camp') || type.includes('site') || type.includes('trans')) {
    return 'site';
  }
  return 'site';
}

function renderNotificationsDropdown(unreadCount = 0) {
  const badge = document.getElementById('notifBadgeCount');
  const headerTag = document.getElementById('notifUnreadHeaderTag');
  const listEl = document.getElementById('adminNotificationsList');
  if (!badge || !listEl) return;

  // اگر اعلان جدیدی وجود داشته باشد شمارنده فعال و نمایش داده می‌شود؛ در غیر این صورت شمارنده حذف و پنهان می‌شود
  if (unreadCount > 0) {
    badge.textContent = window.CampaignDB.toPersianDigits(unreadCount);
    badge.style.display = 'flex';
    badge.removeAttribute('hidden');
    if (headerTag) {
      headerTag.textContent = `${window.CampaignDB.toPersianDigits(unreadCount)} جدید`;
      headerTag.style.display = 'inline-block';
    }
  } else {
    badge.textContent = '';
    badge.style.display = 'none';
    badge.setAttribute('hidden', 'true');
    if (headerTag) {
      headerTag.textContent = '';
      headerTag.style.display = 'none';
    }
  }

  // بروزرسانی شمارنده‌های ۳ تب دسته‌بندی اعلان‌ها (فقط شمارش اعلان‌های خوانده‌نشده)
  const userNotifs = (allNotifications || []).filter(n => getNotificationCategory(n) === 'users');
  const adminNotifs = (allNotifications || []).filter(n => getNotificationCategory(n) === 'admin');
  const siteNotifs = (allNotifications || []).filter(n => getNotificationCategory(n) === 'site');

  const userUnread = userNotifs.filter(n => !n.is_read).length;
  const adminUnread = adminNotifs.filter(n => !n.is_read).length;
  const siteUnread = siteNotifs.filter(n => !n.is_read).length;

  const badgeUsers = document.getElementById('notifCatBadgeUsers');
  const badgeAdmin = document.getElementById('notifCatBadgeAdmin');
  const badgeSite = document.getElementById('notifCatBadgeSite');

  if (badgeUsers) {
    if (userUnread > 0) {
      badgeUsers.textContent = window.CampaignDB.toPersianDigits(userUnread);
      badgeUsers.style.display = 'inline-flex';
    } else {
      badgeUsers.textContent = '';
      badgeUsers.style.display = 'none';
    }
  }
  if (badgeAdmin) {
    if (adminUnread > 0) {
      badgeAdmin.textContent = window.CampaignDB.toPersianDigits(adminUnread);
      badgeAdmin.style.display = 'inline-flex';
    } else {
      badgeAdmin.textContent = '';
      badgeAdmin.style.display = 'none';
    }
  }
  if (badgeSite) {
    if (siteUnread > 0) {
      badgeSite.textContent = window.CampaignDB.toPersianDigits(siteUnread);
      badgeSite.style.display = 'inline-flex';
    } else {
      badgeSite.textContent = '';
      badgeSite.style.display = 'none';
    }
  }

  // بروزرسانی وضعیت فعال بودن تب‌های ۳ گانه
  const catTabs = document.querySelectorAll('#notifCategoryTabs .notif-cat-tab-btn');
  catTabs.forEach(t => {
    t.classList.toggle('active', t.getAttribute('data-notif-category') === activeNotifCategory);
  });

  // فیلتر کردن اعلان‌ها بر اساس تب انتخابی (کاربران، پنل مدیریت، سایت)
  const filteredNotifications = (allNotifications || []).filter(n => getNotificationCategory(n) === activeNotifCategory);

  if (!filteredNotifications || filteredNotifications.length === 0) {
    const categoryTitles = {
      users: 'کاربران',
      admin: 'پنل مدیریت',
      site: 'سایت'
    };
    const catName = categoryTitles[activeNotifCategory] || '';
    listEl.innerHTML = `
      <div class="notif-empty-state">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="margin: 0 auto 8px; opacity: 0.5;">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
        </svg>
        <div>در حال حاضر هیچ اعلانی در بخش «${catName}» وجود ندارد.</div>
      </div>
    `;
    return;
  }

  listEl.innerHTML = filteredNotifications.map(n => {
    let iconClass = 'notif-icon-system';
    let iconSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';

    if (n.type === 'payment') {
      iconClass = 'notif-icon-payment';
      iconSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect><line x1="1" y1="10" x2="23" y2="10"></line></svg>';
    } else if (n.type === 'user' || n.type === 'user_approval' || n.type === 'user_visibility') {
      iconClass = 'notif-icon-user';
      iconSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>';
    } else if (n.type === 'campaign' || n.type === 'campaign_status') {
      iconClass = 'notif-icon-campaign';
      iconSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" y1="22" x2="4" y2="15"></line></svg>';
    } else if (n.type === 'terms_update') {
      iconClass = 'notif-icon-terms';
      iconSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>';
    }

    const timeAgo = formatAdminRelativeTime(n.created_at);

    let actionBtnHtml = '';
    if (n.reversible && !n.undone) {
      actionBtnHtml = `
        <button type="button" class="btn-notif-undo" data-undo-id="${n.id}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>
          <span>لغو تغییرات</span>
        </button>
      `;
    } else if (n.undone) {
      actionBtnHtml = `
        <span class="badge-undone">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
          <span>لغو شد</span>
        </span>
      `;
    }

    return `
      <div class="notif-item-card ${!n.is_read ? 'unread' : ''}" data-notif-item-id="${n.id}">
        <div class="notif-icon-bubble ${iconClass}">
          ${iconSvg}
        </div>
        <div class="notif-body">
          <div class="notif-title-row">
            <span class="notif-title-text">${n.title}</span>
          </div>
          <div class="notif-desc-text">${n.description || ''}</div>
          <div class="notif-footer-row">
            <span class="notif-time-text">${timeAgo}</span>
            ${actionBtnHtml}
          </div>
        </div>
      </div>
    `;
  }).join('');

  listEl.querySelectorAll('.btn-notif-undo').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const notifId = btn.getAttribute('data-undo-id');
      if (notifId) {
        await handleUndoNotification(notifId, btn);
      }
    };
  });

  listEl.querySelectorAll('.notif-item-card').forEach(card => {
    card.onclick = async () => {
      const id = card.getAttribute('data-notif-item-id');
      if (id && card.classList.contains('unread')) {
        try {
          markAdminNotifLocalRead(id);
          card.classList.remove('unread');
          const found = allNotifications.find(n => n.id === id);
          if (found) found.is_read = true;
          const unreadRemaining = allNotifications.filter(n => !n.is_read).length;
          renderNotificationsDropdown(unreadRemaining);
          await window.CampaignDB.markNotificationRead(id);
        } catch (e) {}
      }
    };
  });
}

async function handleUndoNotification(notifId, btnEl) {
  if (btnEl) {
    btnEl.disabled = true;
    btnEl.innerHTML = '<span>در حال لغو...</span>';
  }

  try {
    const res = await window.CampaignDB.undoNotification(notifId);
    if (res.success) {
      showAdminToast(res.message || 'عملیات با موفقیت به حالت قبلی بازگردانده شد.', 'success');
      await reloadAdminData();
      await reloadNotifications();
      renderCurrentSection();
    } else {
      showAdminToast(res.message || 'خطا در لغو تغییرات', 'error');
      if (btnEl) {
        btnEl.disabled = false;
        btnEl.innerHTML = '<span>لغو تغییرات</span>';
      }
    }
  } catch (err) {
    console.error('خطای بازگردانی عملیات:', err);
    showAdminToast(err.message || 'خطا در بازگردانی عملیات', 'error');
    if (btnEl) {
      btnEl.disabled = false;
      btnEl.innerHTML = '<span>لغو تغییرات</span>';
    }
  }
}

function setupNotificationEvents() {
  const toggleBtn = document.getElementById('btnAdminNotificationsToggle');
  const dropdown = document.getElementById('adminNotificationsDropdown');
  const markAllBtn = document.getElementById('btnMarkAllNotifsRead');

  // اتصال رویداد تب‌های ۳ گانه اعلان‌ها (کاربران، پنل مدیریت، سایت)
  const catTabs = document.querySelectorAll('#notifCategoryTabs .notif-cat-tab-btn');
  catTabs.forEach(tab => {
    tab.onclick = (e) => {
      e.stopPropagation();
      const cat = tab.getAttribute('data-notif-category');
      if (cat) {
        activeNotifCategory = cat;
        catTabs.forEach(t => t.classList.toggle('active', t.getAttribute('data-notif-category') === cat));
        const unreadCount = (allNotifications || []).filter(n => !n.is_read).length;
        renderNotificationsDropdown(unreadCount);
      }
    };
  });

  if (toggleBtn && dropdown) {
    toggleBtn.onclick = (e) => {
      e.stopPropagation();
      const isVisible = dropdown.style.display === 'block';
      dropdown.style.display = isVisible ? 'none' : 'block';
    };

    document.addEventListener('click', (e) => {
      if (!dropdown.contains(e.target) && !toggleBtn.contains(e.target)) {
        dropdown.style.display = 'none';
      }
    });
  }

  if (markAllBtn) {
    markAllBtn.onclick = async (e) => {
      e.stopPropagation();
      try {
        markAllAdminNotifsLocalRead(allNotifications);
        allNotifications.forEach(n => {
          n.is_read = true;
        });
        renderNotificationsDropdown(0);
        showAdminToast('همه اعلان‌ها خوانده شدند.', 'info');
        await window.CampaignDB.markAllNotificationsRead();
      } catch (err) {
        console.error('خطا در خواندن همه اعلان‌ها:', err);
      }
    };
  }
}

/**
 * پاپ‌آپ وضعیت عملیات مدیریت:
 * - عملیات موفق: پاپ‌آپ سبز با عنوان "عملیات موفقیت آمیز بود"
 * - عملیات ناموفق: پاپ‌آپ قرمز با عنوان "خطا در عملیات"
 */
function showAdminPopup(title, message, type = 'success') {
  let container = document.getElementById('adminPopupContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'adminPopupContainer';
    container.className = 'admin-popup-container';
    document.body.appendChild(container);
  }

  const popup = document.createElement('div');
  popup.className = `admin-action-popup popup-${type}`;

  let iconSvg = '';
  let badgeClass = 'badge-info';

  if (type === 'success') {
    badgeClass = 'badge-success';
    iconSvg = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>';
  } else if (type === 'error') {
    badgeClass = 'badge-error';
    iconSvg = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>';
  } else {
    badgeClass = 'badge-info';
    iconSvg = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';
  }

  // تنظیم عناوین دقیق درخواستی
  let finalTitle = title;
  let finalMessage = message;

  if (type === 'success') {
    finalTitle = 'عملیات موفقیت آمیز بود';
    if (title && title !== 'success' && title !== 'عملیات موفقیت آمیز بود' && !message) {
      finalMessage = title;
    } else if (!finalMessage) {
      finalMessage = 'عملیات با موفقیت انجام شد.';
    }
  } else if (type === 'error') {
    finalTitle = 'خطا در عملیات';
    if (title && title !== 'error' && title !== 'خطا در عملیات' && !message) {
      finalMessage = title;
    } else if (!finalMessage) {
      finalMessage = 'در انجام عملیات خطایی رخ داده است.';
    }
  } else if (!finalTitle) {
    finalTitle = 'پیام سیستم';
  }

  popup.innerHTML = `
    <div class="popup-icon-badge ${badgeClass}">
      ${iconSvg}
    </div>
    <div class="popup-text-content">
      <div class="popup-title">${finalTitle}</div>
      ${finalMessage ? `<div class="popup-message">${finalMessage}</div>` : ''}
    </div>
    <button type="button" class="btn-popup-dismiss" aria-label="بستن">×</button>
  `;

  let isDismissed = false;
  const dismiss = () => {
    if (isDismissed) return;
    isDismissed = true;
    popup.classList.add('hide');
    setTimeout(() => {
      if (popup.parentNode) popup.parentNode.removeChild(popup);
    }, 280);
  };

  const dismissBtn = popup.querySelector('.btn-popup-dismiss');
  if (dismissBtn) {
    dismissBtn.onclick = (e) => {
      e.stopPropagation();
      dismiss();
    };
  }

  container.appendChild(popup);
  setTimeout(dismiss, 4500);
}

function showAdminToast(message, type = 'info') {
  if (type === 'success') {
    showAdminPopup('عملیات موفقیت آمیز بود', message || 'عملیات با موفقیت انجام شد.', 'success');
  } else if (type === 'error') {
    showAdminPopup('خطا در عملیات', message || 'در انجام عملیات خطایی رخ داده است.', 'error');
  } else {
    showAdminPopup('پیام سیستم', message, 'info');
  }
}

window.showAdminPopup = showAdminPopup;
window.showAdminToast = showAdminToast;

function showAdminConfirm({
  title = 'تایید عملیات',
  message = 'آیا از حذف این مورد اطمینان دارید؟',
  subtext = 'این مورد به بخش زباله‌دان منتقل خواهد شد و در صورت لزوم قابل بازیابی است.',
  confirmText = 'بله، حذف شود',
  cancelText = 'انصراف',
  danger = true
} = {}) {
  return new Promise((resolve) => {
    const modal = document.getElementById('modalAdminConfirm');
    if (!modal) {
      resolve(true);
      return;
    }
    const titleEl = document.getElementById('adminConfirmTitle');
    const msgEl = document.getElementById('adminConfirmMessage');
    const subtextEl = document.getElementById('adminConfirmSubtext');
    const submitBtn = document.getElementById('btnAdminConfirmSubmit');
    const cancelBtn = document.getElementById('btnAdminConfirmCancel');

    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = message;
    if (subtextEl) {
      if (subtext) {
        subtextEl.textContent = subtext;
        subtextEl.style.display = 'block';
      } else {
        subtextEl.style.display = 'none';
      }
    }
    if (submitBtn) {
      submitBtn.textContent = confirmText;
      if (danger) {
        submitBtn.className = 'btn-quick-action danger';
        submitBtn.style.background = '#e11d48';
        submitBtn.style.borderColor = '#e11d48';
        submitBtn.style.color = '#ffffff';
      } else {
        submitBtn.className = 'btn-quick-action primary';
        submitBtn.style.background = '';
        submitBtn.style.borderColor = '';
        submitBtn.style.color = '';
      }
    }
    if (cancelBtn) cancelBtn.textContent = cancelText;

    let isDone = false;
    const finish = (result) => {
      if (isDone) return;
      isDone = true;
      modal.classList.remove('open');
      resolve(result);
    };

    submitBtn.onclick = (e) => {
      if (e) e.preventDefault();
      finish(true);
    };
    cancelBtn.onclick = (e) => {
      if (e) e.preventDefault();
      finish(false);
    };
    modal.querySelectorAll('[data-close-admin-modal]').forEach(b => {
      b.onclick = (e) => {
        if (e) e.preventDefault();
        finish(false);
      };
    });

    modal.classList.add('open');
  });
}
window.showAdminConfirm = showAdminConfirm;

let selectedAddCampaignFile = null;
let selectedEditCampaignFile = null;

async function initAdminPanel(force = false) {
  try {
    const isAuth = force || await window.AdminAuth.isAuthenticatedAdmin();
    if (!isAuth) {
      showLoginView();
      setupLoginEvents();
      return;
    }

    showAdminView();
    await updateAdminUserInfo();
    await reloadAdminData();
    await reloadNotifications();
    setupAdminNavigation();
    setupNotificationEvents();
    setupAdminEvents();
    setupTrashEventListeners();
    setupCooperationEventListeners();
    initImageUploadFeatures();
    initPersianDatePicker();
    renderCurrentSection();

    // بروزرسانی دوره‌ای آرام اعلان‌ها
    if (!window._adminNotifInterval) {
      window._adminNotifInterval = setInterval(() => {
        reloadNotifications();
      }, 25000);
    }
  } catch (err) {
    console.error('خطا در راه‌اندازی پنل ادمین:', err);
    try {
      const isAuth = await window.AdminAuth.isAuthenticatedAdmin();
      if (!isAuth) {
        showLoginView();
        setupLoginEvents();
      } else {
        showAdminView();
        renderCurrentSection();
      }
    } catch (e) {
      showLoginView();
      setupLoginEvents();
    }
  }
}

async function updateAdminUserInfo() {
  const emailEl = document.getElementById('adminLoggedInEmail') || document.getElementById('adminLoggedInPhone');
  if (emailEl) {
    const email = await window.AdminAuth.getAdminEmail();
    emailEl.textContent = email || 'Matinshariati1404@gmail.com';
  }
  if (typeof applyPermissionVisibility === 'function') {
    applyPermissionVisibility();
  }
}

function showLoginView() {
  const loginScreen = document.getElementById('adminLoginScreen');
  const appShell = document.getElementById('adminAppShell');
  if (loginScreen) {
    loginScreen.style.display = 'flex';
    loginScreen.removeAttribute('hidden');
  }
  if (appShell) {
    appShell.style.display = 'none';
    appShell.setAttribute('hidden', '');
  }
}

function showAdminView() {
  const loginScreen = document.getElementById('adminLoginScreen');
  const appShell = document.getElementById('adminAppShell');
  if (loginScreen) {
    loginScreen.style.display = 'none';
    loginScreen.setAttribute('hidden', '');
  }
  if (appShell) {
    appShell.style.display = 'flex';
    appShell.removeAttribute('hidden');
  }
  updateAdminUserInfo();
}

window.showLoginView = showLoginView;
window.showAdminView = showAdminView;

function setupLoginEvents() {
  const loginForm = document.getElementById('adminLoginForm');
  if (!loginForm) return;

  const btnTogglePass = document.getElementById('btnTogglePasswordVisibility');
  const chkShowPass = document.getElementById('chkShowPassword');
  const passInputEl = document.getElementById('adminPasswordInput');
  const eyeOpen = document.getElementById('eyeIconOpen');
  const eyeClosed = document.getElementById('eyeIconClosed');

  function setPasswordVisibility(show) {
    if (!passInputEl) return;
    passInputEl.type = show ? 'text' : 'password';
    if (eyeOpen) eyeOpen.style.display = show ? 'block' : 'none';
    if (eyeClosed) eyeClosed.style.display = show ? 'none' : 'block';
    if (chkShowPass && chkShowPass.checked !== show) chkShowPass.checked = show;
  }

  if (btnTogglePass && passInputEl) {
    btnTogglePass.onclick = (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      const isCurrentlyShown = passInputEl.type === 'text';
      setPasswordVisibility(!isCurrentlyShown);
      passInputEl.focus();
    };
  }

  if (chkShowPass && passInputEl) {
    chkShowPass.onchange = () => {
      setPasswordVisibility(chkShowPass.checked);
    };
  }

  loginForm.onsubmit = async (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    const emailInput = (document.getElementById('adminEmailInput')?.value || '').trim();
    const passInput = (document.getElementById('adminPasswordInput')?.value || '').trim();
    const submitBtn = document.getElementById('btnAdminLoginSubmit') || loginForm.querySelector('button[type="submit"]');
    const errorEl = document.getElementById('loginErrorMessage');
    if (errorEl) errorEl.style.display = 'none';

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span>در حال بررسی...</span>';
    }

    try {
      const result = await window.AdminAuth.loginAdmin(emailInput, passInput);
      if (result.success) {
        showAdminToast(result.message || 'ورود با موفقیت انجام شد.', 'success');
        showAdminView();
        await initAdminPanel(true);
      } else {
        if (errorEl) {
          errorEl.textContent = result.message || 'اطلاعات ورود نادرست است.';
          errorEl.style.display = 'block';
        }
      }
    } catch (err) {
      if (errorEl) {
        errorEl.textContent = `خطا: ${err.message}`;
        errorEl.style.display = 'block';
      }
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = 'ورود به پنل مدیریت';
      }
    }
  };
}

async function reloadAdminData() {
  try {
    allCampaigns = await window.CampaignDB.getCampaigns();
  } catch (err) {
    console.warn('خطا در دریافت لیست پویش‌ها:', err);
    allCampaigns = allCampaigns || [];
  }
  try {
    allPayments = await window.CampaignDB.getPayments();
  } catch (err) {
    console.warn('خطا در دریافت لیست پرداخت‌ها:', err);
    allPayments = allPayments || [];
  }
  try {
    if (typeof loadCooperationData === 'function') {
      await loadCooperationData();
    }
  } catch (err) {
    console.warn('خطا در دریافت درخواست‌های همکاری:', err);
  }
  try {
    if (typeof loadTicketsData === 'function') {
      await loadTicketsData();
    }
  } catch (err) {
    console.warn('خطا در دریافت تیکت‌ها:', err);
  }
  try {
    if (typeof loadTrashData === 'function') {
      await loadTrashData();
    }
  } catch (err) {
    console.warn('خطا در دریافت زباله‌دان:', err);
  }
}

function setupAdminNavigation() {
  const navBtns = document.querySelectorAll('.sidebar-nav .nav-item-btn');
  const sidebar = document.getElementById('adminSidebar');
  const overlay = document.getElementById('sidebarOverlay');

  navBtns.forEach(btn => {
    btn.onclick = () => {
      const section = btn.getAttribute('data-section');
      if (section) {
        navigateToSection(section);
      }
      if (sidebar && window.innerWidth < 900) {
        sidebar.classList.remove('open');
        if (overlay) overlay.classList.remove('active');
      }
    };
  });

  const logoutBtn = document.getElementById('btnAdminLogout');
  if (logoutBtn) {
    logoutBtn.onclick = () => {
      const modal = document.getElementById('modalConfirmLogout');
      if (modal) {
        modal.classList.add('open');
      } else {
        window.AdminAuth.logoutAdmin();
      }
    };
  }

  const btnConfirmLogoutYes = document.getElementById('btnConfirmLogoutYes');
  if (btnConfirmLogoutYes) {
    btnConfirmLogoutYes.onclick = () => {
      const modal = document.getElementById('modalConfirmLogout');
      if (modal) modal.classList.remove('open');
      window.AdminAuth.logoutAdmin();
    };
  }

  const toggleBtn = document.getElementById('btnToggleSidebar');
  if (toggleBtn && sidebar) {
    toggleBtn.onclick = () => {
      const isOpen = sidebar.classList.toggle('open');
      if (overlay) {
        if (isOpen) overlay.classList.add('active');
        else overlay.classList.remove('active');
      }
    };
  }

  if (overlay) {
    overlay.onclick = () => {
      if (sidebar) sidebar.classList.remove('open');
      overlay.classList.remove('active');
    };
  }
}

function navigateToSection(sectionName) {
  const navBtn = document.querySelector(`.sidebar-nav .nav-item-btn[data-section="${sectionName}"]`);
  const reqPerm = navBtn ? navBtn.getAttribute('data-permission') : null;
  if (reqPerm && window.AdminAuth && typeof window.AdminAuth.hasPermission === 'function') {
    if (!window.AdminAuth.hasPermission(reqPerm)) {
      showAdminToast('دسترسی غیرمجاز: شما مجوز ورود به این بخش را ندارید.', 'error');
      return;
    }
  }

  if (sectionName === 'add-campaign') {
    navigateToSection('campaigns');
    openAddCampaignModal();
    return;
  }

  activeSection = sectionName;
  document.querySelectorAll('.sidebar-nav .nav-item-btn').forEach(btn => {
    if (btn.getAttribute('data-section') === sectionName) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  document.querySelectorAll('.admin-section').forEach(sec => {
    sec.classList.remove('active');
  });

  const targetSec = document.getElementById(`section-${sectionName}`);
  if (targetSec) {
    targetSec.classList.add('active');
  }

  const breadcrumbEl = document.getElementById('adminBreadcrumb');
  if (breadcrumbEl) {
    const titles = {
      dashboard: 'داشبورد',
      campaigns: 'پویش‌ها',
      'add-campaign': 'ایجاد پویش جدید',
      payments: 'مدیریت تراکنش‌ها و واریزی‌ها',
      reports: 'گزارشات و عملکرد مالی',
      users: 'مدیریت کاربران و مشارکت‌کنندگان',
      cooperation: 'درخواست‌ها',
      tickets: 'پیام‌ها و تیکت‌های پشتیبانی',
      sms: 'پنل پیامک و اطلاع‌رسانی',
      admins: 'مدیریت',
      trash: 'زباله‌دان',
      logs: 'لاگ',
      settings: 'تنظیمات'
    };
    breadcrumbEl.textContent = titles[sectionName] || 'مدیریت';
  }

  renderCurrentSection();
}

window.navigateToSection = navigateToSection;

function renderCurrentSection() {
  switch (activeSection) {
    case 'dashboard':
      renderDashboard();
      break;
    case 'campaigns':
      renderCampaignsTable();
      break;
    case 'add-campaign':
      resetAddCampaignForm();
      break;
    case 'payments':
      renderPaymentsTable();
      break;
    case 'reports':
      renderReports();
      break;
    case 'users':
      renderUsersSection();
      break;
    case 'cooperation':
      renderCooperationSection();
      break;
    case 'tickets':
      renderTicketsSection();
      break;
    case 'sms':
      renderSmsSection();
      break;
    case 'admins':
      renderAdminsSection();
      break;
    case 'trash':
      loadTrashData().then(() => renderTrashSection());
      break;
    case 'logs':
      renderLogsSection();
      break;
    case 'settings':
      renderSettings();
      break;
  }
}

function renderDashboard() {
  const totalCampaigns = allCampaigns.length;
  const activeCampaigns = allCampaigns.filter(c => c.status === 'active').length;
  const successfulPayments = allPayments.filter(p => p.status === 'successful' || p.status === 'success');
  const totalCompletedShares = successfulPayments.reduce((sum, p) => sum + (Number(p.shares) || 0), 0);
  const totalCollectedAmount = successfulPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

  const totalCampEl = document.getElementById('dashTotalCampaigns');
  if (totalCampEl) totalCampEl.textContent = window.CampaignDB.formatNumber(totalCampaigns);

  const activeCampEl = document.getElementById('dashActiveCampaigns');
  if (activeCampEl) activeCampEl.textContent = window.CampaignDB.formatNumber(activeCampaigns);

  const completedSharesEl = document.getElementById('dashCompletedShares');
  if (completedSharesEl) completedSharesEl.textContent = window.CampaignDB.formatNumber(totalCompletedShares);

  const collectedAmountEl = document.getElementById('dashCollectedAmount');
  if (collectedAmountEl) collectedAmountEl.textContent = window.CampaignDB.formatCurrency(totalCollectedAmount);

  const activeCamp = allCampaigns.find(c => c.status === 'active') || allCampaigns[0];
  const activeCampBox = document.getElementById('dashActiveCampaignSpotlight');

  if (activeCamp && activeCampBox) {
    const stats = window.CampaignDB.calculateCampaignStats(activeCamp, allPayments);
    activeCampBox.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; flex-wrap: wrap; gap: 12px;">
        <div>
          <span class="badge-status ${activeCamp.status}">${getCampaignStatusLabel(activeCamp.status)}</span>
          <h3 style="font-size: 1.25rem; font-weight: 800; color: #0f172a; margin-top: 6px;">${activeCamp.title}</h3>
        </div>
        <div style="text-align: left;">
          <div style="font-size: 1.6rem; font-weight: 900; color: #047857;">${window.CampaignDB.toPersianDigits(stats.progress)}٪</div>
          <div style="font-size: 0.8rem; color: #64748b;">پیشرفت پویش فعال</div>
        </div>
      </div>
      <div style="height: 10px; background: #e2e8f0; border-radius: 99px; overflow: hidden; margin-bottom: 18px;">
        <div style="width: ${Math.min(100, stats.progress)}%; height: 100%; background: linear-gradient(90deg, #059669, #10b981);"></div>
      </div>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 12px; font-size: 0.85rem;">
        <div style="background: #f8fafc; padding: 10px; border-radius: 8px;">
          <span style="color: #64748b; display: block; font-size: 0.75rem;">هدف مالی:</span>
          <strong>${window.CampaignDB.formatCurrency(stats.target_amount)}</strong>
        </div>
        <div style="background: #f8fafc; padding: 10px; border-radius: 8px;">
          <span style="color: #64748b; display: block; font-size: 0.75rem;">جمع‌آوری شده:</span>
          <strong style="color: #047857;">${window.CampaignDB.formatCurrency(stats.collected_amount)}</strong>
        </div>
        <div style="background: #f8fafc; padding: 10px; border-radius: 8px;">
          <span style="color: #64748b; display: block; font-size: 0.75rem;">سهم‌های تکمیل‌شده:</span>
          <strong>${window.CampaignDB.formatNumber(stats.paid_shares)} از ${window.CampaignDB.formatNumber(stats.total_shares)}</strong>
        </div>
        <div style="background: #f8fafc; padding: 10px; border-radius: 8px;">
          <span style="color: #64748b; display: block; font-size: 0.75rem;">باقیمانده:</span>
          <strong style="color: #d97706;">${window.CampaignDB.formatNumber(stats.remaining_shares)} سهم</strong>
        </div>
      </div>
    `;
  }

  const dashPaymentsTbody = document.getElementById('dashRecentPaymentsTable');
  if (dashPaymentsTbody) {
    const recent = allPayments.slice(0, 5);
    if (recent.length === 0) {
      dashPaymentsTbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #94a3b8; padding: 20px;">هیچ پرداختی ثبت نشده است.</td></tr>';
    } else {
      dashPaymentsTbody.innerHTML = recent.map(p => {
        const camp = allCampaigns.find(c => String(c.id) === String(p.campaign_id));
        return `
          <tr>
            <td style="font-weight: 700; color: #047857;">${p.tracking_code || '-'}</td>
            <td><strong>${p.payer_name || 'ناشناس'}</strong></td>
            <td>${camp ? camp.title : 'نامشخص'}</td>
            <td><strong style="color: #047857;">${window.CampaignDB.toPersianDigits(p.shares)} سهم</strong></td>
            <td>${window.CampaignDB.formatCurrency(p.amount)}</td>
            <td><span class="badge-status ${p.status}">${getPaymentStatusPersianLabel(p.status)}</span></td>
          </tr>
        `;
      }).join('');
    }
  }
}

function getCampaignStatusLabel(status) {
  const map = {
    active: 'فعال',
    inactive: 'غیرفعال',
    pending: 'به زودی',
    completed: 'تمام شده'
  };
  return map[status] || status || 'فعال';
}

function getPaymentStatusPersianLabel(status) {
  const map = {
    pending: 'در انتظار پرداخت',
    success: 'موفق و تایید شده',
    successful: 'موفق و تایید شده',
    failed: 'ناموفق',
    cancelled: 'لغو شده',
    verification_failed: 'عدم تایید'
  };
  return map[status] || status;
}

function renderCampaignsTable() {
  const tbody = document.getElementById('campaignsTableBody');
  if (!tbody) return;
  if (allCampaigns.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 32px; color: #94a3b8;">هیچ پویشی یافت نشد.</td></tr>`;
    return;
  }

  // Ensure active campaign is always sorted to the first row (index 0)
  allCampaigns.sort((a, b) => {
    if (a.status === 'active' && b.status !== 'active') return -1;
    if (b.status === 'active' && a.status !== 'active') return 1;
    return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
  });

  tbody.innerHTML = allCampaigns.map(camp => {
    const stats = window.CampaignDB.calculateCampaignStats(camp, allPayments);
    const hasImageBadge = camp.image_url ? '<span style="display:inline-flex; align-items:center; color:#047857; margin-left:4px;" title="دارای پوستر"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></span>' : '';
    const isActive = camp.status === 'active';
    const rowClass = isActive ? 'active-campaign-row' : '';
    const activeStarBadge = isActive ? '<span style="background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; border-radius: 6px; padding: 2px 7px; font-size: 0.72rem; font-weight: 800; margin-right: 8px; display: inline-flex; align-items: center; gap: 4px;">★ پویش فعال اصلی</span>' : '';

    return `
      <tr class="${rowClass}">
        <td style="font-weight: 800; color: #0f172a;">${hasImageBadge}${camp.title}${activeStarBadge}</td>
        <td>${window.CampaignDB.formatNumber(stats.total_shares)}</td>
        <td>${window.CampaignDB.formatCurrency(stats.share_price)}</td>
        <td style="font-weight: 700;">${window.CampaignDB.formatCurrency(stats.target_amount)}</td>
        <td style="color: #047857; font-weight: 700;">${window.CampaignDB.formatNumber(stats.paid_shares)}</td>
        <td style="color: #d97706; font-weight: 700;">${window.CampaignDB.formatNumber(stats.remaining_shares)}</td>
        <td>
          <div style="display: flex; align-items: center; gap: 8px;">
            <div style="flex: 1; min-width: 60px; height: 6px; background: #e2e8f0; border-radius: 99px; overflow: hidden;">
              <div style="width: ${Math.min(100, stats.progress)}%; height: 100%; background: #059669;"></div>
            </div>
            <span style="font-size: 0.8rem; font-weight: 700;">${window.CampaignDB.toPersianDigits(stats.progress)}٪</span>
          </div>
        </td>
        <td>
          <select class="form-control-select camp-status-select ${camp.status}" style="padding: 4px 8px; font-size: 0.82rem; font-weight: 700; width: auto; border-radius: 8px;" onchange="changeCampaignStatus('${camp.id}', this.value)">
            <option value="active" ${camp.status === 'active' ? 'selected' : ''}>فعال</option>
            <option value="inactive" ${camp.status === 'inactive' ? 'selected' : ''}>غیرفعال</option>
            <option value="pending" ${camp.status === 'pending' ? 'selected' : ''}>به زودی</option>
            <option value="completed" ${camp.status === 'completed' ? 'selected' : ''}>تمام شده</option>
          </select>
        </td>
        <td>
          <div class="table-actions-cell">
            <button type="button" class="btn-row-action btn-action-edit" onclick="openEditCampaignModal('${camp.id}')">ویرایش</button>
            <button type="button" class="btn-row-action" onclick="openCampaignDetailsModal('${camp.id}')">مشاهده</button>
            <button type="button" class="btn-row-action btn-action-delete" onclick="confirmDeleteCampaign('${camp.id}')">حذف</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

window.changeCampaignStatus = async function(campaignId, newStatus) {
  const camp = allCampaigns.find(c => String(c.id) === String(campaignId));
  if (!camp) return;

  if (newStatus === 'active') {
    allCampaigns.forEach(c => {
      if (String(c.id) !== String(campaignId) && c.status === 'active') {
        c.status = 'inactive';
      }
    });
  }

  await window.CampaignDB.updateCampaign(campaignId, { status: newStatus });
  await reloadAdminData();
  await reloadNotifications();
  renderCampaignsTable();
  renderDashboard();
  const extraNote = newStatus === 'active' ? ' (پویش به ردیف اول منتقل شد و سایر پویش‌ها غیرفعال شدند)' : '';
  showAdminToast(`وضعیت پویش «${camp.title}» به ${getCampaignStatusLabel(newStatus)} تغییر یافت.${extraNote}`, 'success');
};

window.confirmDeleteCampaign = async function(campaignId) {
  const camp = allCampaigns.find(c => String(c.id) === String(campaignId));
  if (!camp) return;
  const relatedPayments = allPayments.filter(p => String(p.campaign_id) === String(campaignId));
  let subtext = 'اطلاعات این پویش به همراه تنظیمات آن به زباله‌دان منتقل خواهد شد و در صورت لزوم قابل بازیابی است.';
  if (relatedPayments.length > 0) {
    subtext = `این پویش دارای ${window.CampaignDB.toPersianDigits(relatedPayments.length)} تراکنش ثبت شده است. با حذف پویش، تراکنش‌های آن نیز به زباله‌دان منتقل می‌شوند.`;
  }
  const ok = await showAdminConfirm({
    title: 'تایید حذف پویش',
    message: `آیا از حذف پویش «${camp.title}» اطمینان دارید؟`,
    subtext,
    confirmText: 'بله، حذف پویش',
    danger: true
  });
  if (ok) {
    await executeDeleteCampaign(campaignId);
  }
};

async function executeDeleteCampaign(campaignId) {
  try {
    const res = await window.CampaignDB.deleteCampaign(campaignId);
    await reloadAdminData();
    await reloadNotifications();
    renderCampaignsTable();
    renderDashboard();
    showAdminToast(res?.message || 'پویش با موفقیت به زباله‌دان منتقل گردید.', 'success');
  } catch (err) {
    showAdminToast(err.message || 'خطا در حذف پویش.', 'error');
  }
}
window.executeDeleteCampaign = executeDeleteCampaign;

window.openCampaignDetailsModal = function(campaignId) {
  const camp = allCampaigns.find(c => String(c.id) === String(campaignId));
  if (!camp) return;
  const stats = window.CampaignDB.calculateCampaignStats(camp, allPayments);
  const campPayments = allPayments.filter(p => String(p.campaign_id) === String(campaignId));
  const modalBody = document.getElementById('campaignDetailsModalBody');
  modalBody.innerHTML = `
    <div style="display: flex; gap: 20px; margin-bottom: 20px; align-items: center; flex-wrap: wrap;">
      ${camp.image_url ? `<img src="${camp.image_url}" style="width: 100px; height: 75px; object-fit: cover; border-radius: 8px; border: 1px solid #cbd5e1;" />` : ''}
      <div style="flex: 1;">
        <span class="badge-status ${camp.status}" style="margin-bottom: 6px;">${getCampaignStatusLabel(camp.status)}</span>
        <h3 style="font-size: 1.4rem; font-weight: 800; color: #0f172a;">${camp.title}</h3>
        <p style="color: #64748b; font-size: 0.9rem; margin-top: 4px;">${camp.description || 'بدون توضیحات'}</p>
      </div>
      <div>
        <a href="/index.html?id=${camp.id}" target="_blank" class="btn-quick-action primary" style="font-size: 0.85rem;">
          مشاهده صفحه عمومی
        </a>
      </div>
    </div>
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 12px; margin-bottom: 24px;">
      <div style="background: #f8fafc; padding: 12px; border-radius: 8px; border: 1px solid #e2e8f0;">
        <div style="font-size: 0.78rem; color: #64748b;">کل سهم‌ها</div>
        <div style="font-size: 1.1rem; font-weight: 800;">${window.CampaignDB.formatNumber(stats.total_shares)}</div>
      </div>
      <div style="background: #f8fafc; padding: 12px; border-radius: 8px; border: 1px solid #e2e8f0;">
        <div style="font-size: 0.78rem; color: #64748b;">سهم‌های تکمیل‌شده</div>
        <div style="font-size: 1.1rem; font-weight: 800; color: #047857;">${window.CampaignDB.formatNumber(stats.paid_shares)}</div>
      </div>
      <div style="background: #f8fafc; padding: 12px; border-radius: 8px; border: 1px solid #e2e8f0;">
        <div style="font-size: 0.78rem; color: #64748b;">سهم‌های باقیمانده</div>
        <div style="font-size: 1.1rem; font-weight: 800; color: #d97706;">${window.CampaignDB.formatNumber(stats.remaining_shares)}</div>
      </div>
      <div style="background: #f8fafc; padding: 12px; border-radius: 8px; border: 1px solid #e2e8f0;">
        <div style="font-size: 0.78rem; color: #64748b;">قیمت هر سهم</div>
        <div style="font-size: 1.1rem; font-weight: 800;">${window.CampaignDB.formatCurrency(stats.share_price)}</div>
      </div>
      <div style="background: #f8fafc; padding: 12px; border-radius: 8px; border: 1px solid #e2e8f0;">
        <div style="font-size: 0.78rem; color: #64748b;">مبلغ هدف</div>
        <div style="font-size: 1.1rem; font-weight: 800;">${window.CampaignDB.formatCurrency(stats.target_amount)}</div>
      </div>
      <div style="background: #f8fafc; padding: 12px; border-radius: 8px; border: 1px solid #e2e8f0;">
        <div style="font-size: 0.78rem; color: #64748b;">مبلغ جمع‌آوری شده</div>
        <div style="font-size: 1.1rem; font-weight: 800; color: #047857;">${window.CampaignDB.formatCurrency(stats.collected_amount)}</div>
      </div>
    </div>
    <h4 style="font-size: 1rem; font-weight: 800; margin-bottom: 12px;">لیست پرداخت‌ها (${window.CampaignDB.toPersianDigits(campPayments.length)})</h4>
    <div style="max-height: 220px; overflow-y: auto; border: 1px solid #e2e8f0; border-radius: 8px;">
      <table class="admin-table" style="font-size: 0.84rem;">
        <thead>
          <tr>
            <th>کد پیگیری</th>
            <th>واریز کننده</th>
            <th>سهم</th>
            <th>مبلغ</th>
            <th>وضعیت</th>
          </tr>
        </thead>
        <tbody>
          ${campPayments.length === 0 ? '<tr><td colspan="5" style="text-align: center; color: #94a3b8; padding: 16px;">هیچ واریزی ثبت نشده است.</td></tr>' : 
            campPayments.map(p => `
              <tr>
                <td>${p.tracking_code}</td>
                <td><strong>${p.payer_name || 'ناشناس'}</strong></td>
                <td>${window.CampaignDB.toPersianDigits(p.shares)}</td>
                <td>${window.CampaignDB.formatCurrency(p.amount)}</td>
                <td><span class="badge-status ${p.status}">${getPaymentStatusPersianLabel(p.status)}</span></td>
              </tr>
            `).join('')}
        </tbody>
      </table>
    </div>
  `;
  document.getElementById('modalCampaignDetails').classList.add('open');
};

function resetAddCampaignForm() {
  editingCampaignId = null;
  const form = document.getElementById('formAddCampaign');
  if (form) form.reset();
  const previewBox = document.getElementById('addCampImagePreviewBox');
  const previewImg = document.getElementById('addCampImagePreview');
  const hiddenInput = document.getElementById('addCampImage');
  if (hiddenInput) hiddenInput.value = '';
  if (previewImg) previewImg.src = '';
  if (previewBox) previewBox.style.display = 'none';

  const addCampSecTitle = document.getElementById('addCampaignSectionTitle');
  if (addCampSecTitle) addCampSecTitle.textContent = 'ایجاد و انتشار پویش جدید';
  const saveBtn = document.getElementById('btnSaveCampaign');
  if (saveBtn) saveBtn.textContent = 'ذخیره و انتشار پویش';
  updateAddCampaignCalculation();
}

window.openAddCampaignModal = function() {
  resetAddCampaignForm();
  const modal = document.getElementById('modalAddCampaign');
  if (modal) {
    modal.classList.add('open');
  }
};

function updateAddCampaignCalculation() {
  const sharesInput = document.getElementById('addCampTotalShares');
  const priceInput = document.getElementById('addCampSharePrice');
  if (!sharesInput || !priceInput) return;
  const shares = parseInt(window.CampaignDB.toEnglishDigits(sharesInput.value), 10) || 0;
  const price = parseInt(window.CampaignDB.toEnglishDigits(priceInput.value), 10) || 0;
  const target = shares * price;
  const targetEl = document.getElementById('addCampTargetAmountDisplay');
  if (targetEl) {
    targetEl.textContent = window.CampaignDB.formatCurrency(target);
  }
}

window.openEditCampaignModal = function(campaignId) {
  const camp = allCampaigns.find(c => String(c.id) === String(campaignId));
  if (!camp) return;
  editingCampaignId = camp.id;
  selectedEditCampaignFile = null;

  document.getElementById('editCampId').value = camp.id;
  document.getElementById('editCampTitle').value = camp.title;
  document.getElementById('editCampDesc').value = camp.description || '';
  document.getElementById('editCampTotalShares').value = camp.total_shares;
  document.getElementById('editCampSharePrice').value = camp.share_price;
  document.getElementById('editCampStartDate').value = camp.start_date || '';
  document.getElementById('editCampEndDate').value = camp.end_date || '';
  document.getElementById('editCampStatus').value = camp.status || 'active';

  document.getElementById('editCampEventLocation').value = camp.event_location || '';
  document.getElementById('editCampEventDate').value = camp.event_date || '';
  document.getElementById('editCampEventTime').value = camp.event_time || '';
  document.getElementById('editCampChannelLink').value = camp.channel_link || '';
  document.getElementById('editCampSocialLink').value = camp.social_link || '';
  document.getElementById('editCampContactPhone').value = camp.contact_phone || '';
  document.getElementById('editCampAdditionalNotes').value = camp.additional_notes || '';

  const editHiddenInput = document.getElementById('editCampImage');
  const editPreviewImg = document.getElementById('editCampImagePreview');
  const editPreviewBox = document.getElementById('editCampImagePreviewBox');
  const editUrlInput = document.getElementById('editCampImageUrlInput');

  if (camp.image_url) {
    if (editHiddenInput) editHiddenInput.value = camp.image_url;
    if (editUrlInput) editUrlInput.value = camp.image_url;
    if (editPreviewImg) editPreviewImg.src = camp.image_url;
    if (editPreviewBox) editPreviewBox.style.display = 'block';
  } else {
    if (editHiddenInput) editHiddenInput.value = '';
    if (editUrlInput) editUrlInput.value = '';
    if (editPreviewImg) editPreviewImg.src = '';
    if (editPreviewBox) editPreviewBox.style.display = 'none';
  }

  const shares = parseInt(camp.total_shares, 10) || 0;
  const price = parseInt(camp.share_price, 10) || 0;
  document.getElementById('editCampTargetAmountDisplay').textContent = window.CampaignDB.formatCurrency(shares * price);

  document.getElementById('modalEditCampaign').classList.add('open');
};

function initImageUploadFeatures() {
  const addFileInput = document.getElementById('addCampImageFile');
  const addUrlInput = document.getElementById('addCampImageUrlInput');
  const addHiddenInput = document.getElementById('addCampImage');
  const addPreviewBox = document.getElementById('addCampImagePreviewBox');
  const addPreviewImg = document.getElementById('addCampImagePreview');
  const btnRemoveAdd = document.getElementById('btnRemoveAddImage');

  if (addFileInput) {
    addFileInput.onchange = (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) {
        selectedAddCampaignFile = file;
        const objectUrl = URL.createObjectURL(file);
        if (addPreviewImg) addPreviewImg.src = objectUrl;
        if (addPreviewBox) addPreviewBox.style.display = 'block';
        if (addUrlInput) addUrlInput.value = '';
        if (addHiddenInput) addHiddenInput.value = '';
        showAdminToast('تصویر انتخاب شد.', 'info');
      }
    };
  }

  if (addUrlInput) {
    addUrlInput.oninput = () => {
      const url = addUrlInput.value.trim();
      if (url) {
        selectedAddCampaignFile = null;
        if (addFileInput) addFileInput.value = '';
        if (addHiddenInput) addHiddenInput.value = url;
        if (addPreviewImg) addPreviewImg.src = url;
        if (addPreviewBox) addPreviewBox.style.display = 'block';
      } else {
        if (!selectedAddCampaignFile) {
          if (addHiddenInput) addHiddenInput.value = '';
          if (addPreviewBox) addPreviewBox.style.display = 'none';
        }
      }
    };
  }

  if (btnRemoveAdd) {
    btnRemoveAdd.onclick = (e) => {
      e.preventDefault();
      selectedAddCampaignFile = null;
      if (addHiddenInput) addHiddenInput.value = '';
      if (addFileInput) addFileInput.value = '';
      if (addUrlInput) addUrlInput.value = '';
      if (addPreviewImg) addPreviewImg.src = '';
      if (addPreviewBox) addPreviewBox.style.display = 'none';
      showAdminToast('تصویر حذف شد.', 'info');
    };
  }

  const editFileInput = document.getElementById('editCampImageFile');
  const editUrlInput = document.getElementById('editCampImageUrlInput');
  const editHiddenInput = document.getElementById('editCampImage');
  const editPreviewBox = document.getElementById('editCampImagePreviewBox');
  const editPreviewImg = document.getElementById('editCampImagePreview');
  const btnRemoveEdit = document.getElementById('btnRemoveEditImage');

  if (editFileInput) {
    editFileInput.onchange = (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) {
        selectedEditCampaignFile = file;
        const objectUrl = URL.createObjectURL(file);
        if (editPreviewImg) editPreviewImg.src = objectUrl;
        if (editPreviewBox) editPreviewBox.style.display = 'block';
        if (editUrlInput) editUrlInput.value = '';
        if (editHiddenInput) editHiddenInput.value = '';
        showAdminToast('تصویر جدید انتخاب شد.', 'info');
      }
    };
  }

  if (editUrlInput) {
    editUrlInput.oninput = () => {
      const url = editUrlInput.value.trim();
      if (url) {
        selectedEditCampaignFile = null;
        if (editFileInput) editFileInput.value = '';
        if (editHiddenInput) editHiddenInput.value = url;
        if (editPreviewImg) editPreviewImg.src = url;
        if (editPreviewBox) editPreviewBox.style.display = 'block';
      }
    };
  }

  if (btnRemoveEdit) {
    btnRemoveEdit.onclick = (e) => {
      e.preventDefault();
      selectedEditCampaignFile = null;
      if (editHiddenInput) editHiddenInput.value = '';
      if (editFileInput) editFileInput.value = '';
      if (editUrlInput) editUrlInput.value = '';
      if (editPreviewImg) editPreviewImg.src = '';
      if (editPreviewBox) editPreviewBox.style.display = 'none';
      showAdminToast('تصویر حذف شد.', 'info');
    };
  }
}

function initPersianDatePicker() {
  const modal = document.getElementById('modalPersianDatePicker');
  const closeBtn = document.getElementById('btnCloseDatePicker');
  const selectYear = document.getElementById('dpSelectYear');
  const selectMonth = document.getElementById('dpSelectMonth');
  const daysGrid = document.getElementById('dpDaysGrid');
  const btnPrev = document.getElementById('dpBtnPrevMonth');
  const btnNext = document.getElementById('dpBtnNextMonth');

  if (!modal || !daysGrid) return;

  function renderCalendarDays(year, month) {
    daysGrid.innerHTML = '';
    const daysInMonth = month <= 6 ? 31 : (month <= 11 ? 30 : 29);

    let activeY = null, activeM = null, activeD = null;
    if (activeDatepickerInput && activeDatepickerInput.value) {
      const cleanVal = window.CampaignDB.toEnglishDigits(activeDatepickerInput.value).trim();
      const parts = cleanVal.split('/');
      if (parts.length === 3) {
        activeY = parseInt(parts[0], 10);
        activeM = parseInt(parts[1], 10);
        activeD = parseInt(parts[2], 10);
      }
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dayCell = document.createElement('button');
      dayCell.type = 'button';
      dayCell.className = 'datepicker-day-cell';
      dayCell.textContent = window.CampaignDB.toPersianDigits(day);
      
      if (activeY === year && activeM === month && activeD === day) {
        dayCell.classList.add('selected');
      }

      dayCell.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (activeDatepickerInput) {
          const mStr = String(month).padStart(2, '0');
          const dStr = String(day).padStart(2, '0');
          const dateStr = `${year}/${mStr}/${dStr}`;
          activeDatepickerInput.value = window.CampaignDB.toPersianDigits(dateStr);
          activeDatepickerInput.dispatchEvent(new Event('change', { bubbles: true }));
          activeDatepickerInput.dispatchEvent(new Event('input', { bubbles: true }));
          showAdminToast(`تاریخ ${window.CampaignDB.toPersianDigits(dateStr)} انتخاب شد.`, 'info');
        }
        modal.classList.remove('open');
      };
      daysGrid.appendChild(dayCell);
    }
  }

  if (selectYear && selectMonth) {
    selectYear.onchange = () => renderCalendarDays(parseInt(selectYear.value, 10), parseInt(selectMonth.value, 10));
    selectMonth.onchange = () => renderCalendarDays(parseInt(selectMonth.value, 10), parseInt(selectMonth.value, 10));
  }

  if (btnPrev && selectMonth && selectYear) {
    btnPrev.onclick = (e) => {
      e.preventDefault();
      let m = parseInt(selectMonth.value, 10);
      let y = parseInt(selectYear.value, 10);
      if (m > 1) m--;
      else { m = 12; y--; }
      selectMonth.value = String(m);
      selectYear.value = String(y);
      renderCalendarDays(y, m);
    };
  }

  if (btnNext && selectMonth && selectYear) {
    btnNext.onclick = (e) => {
      e.preventDefault();
      let m = parseInt(selectMonth.value, 10);
      let y = parseInt(selectYear.value, 10);
      if (m < 12) m++;
      else { m = 1; y++; }
      selectMonth.value = String(m);
      selectYear.value = String(y);
      renderCalendarDays(y, m);
    };
  }

  document.querySelectorAll('[data-quick-date]').forEach(btn => {
    btn.onclick = (e) => {
      e.preventDefault();
      if (!activeDatepickerInput) return;
      const q = btn.getAttribute('data-quick-date');
      let y = parseInt(selectYear.value, 10) || 1403;
      let m = parseInt(selectMonth.value, 10) || 9;
      let d = 1;
      if (q === 'today') d = 1;
      else if (q === 'plus10') d = 10;
      else if (q === 'plus20') d = 20;
      else if (q === 'plus30') { m = m < 12 ? m + 1 : 1; d = 1; }
      else if (q === 'plus60') { m = m <= 10 ? m + 2 : (m === 11 ? 1 : 2); d = 1; }
      const mStr = String(m).padStart(2, '0');
      const dStr = String(d).padStart(2, '0');
      const dateStr = `${y}/${mStr}/${dStr}`;
      activeDatepickerInput.value = window.CampaignDB.toPersianDigits(dateStr);
      modal.classList.remove('open');
    };
  });

  if (closeBtn) closeBtn.onclick = () => modal.classList.remove('open');

  window.openPersianDatePicker = function(inputElOrId) {
    const input = typeof inputElOrId === 'string' ? document.getElementById(inputElOrId) : inputElOrId;
    if (!input) return;
    activeDatepickerInput = input;
    const curYear = parseInt(selectYear?.value || '1403', 10);
    const curMonth = parseInt(selectMonth?.value || '9', 10);
    renderCalendarDays(curYear, curMonth);
    modal.classList.add('open');
  };
}

function getFilteredPayments() {
  const statusFilter = paymentFilters.status;
  const nameQuery = (paymentFilters.name || '').trim().toLowerCase();
  const trackQuery = window.CampaignDB.toEnglishDigits(paymentFilters.tracking || '').trim().toUpperCase();
  const phoneQuery = window.CampaignDB.toEnglishDigits(paymentFilters.phone || '').trim();

  return allPayments.filter(pay => {
    // 1. فیلتر وضعیت
    if (statusFilter !== 'all') {
      if (statusFilter === 'successful' || statusFilter === 'success') {
        if (pay.status !== 'successful' && pay.status !== 'success') return false;
      } else if (pay.status !== statusFilter) {
        return false;
      }
    }
    // 2. فیلتر بازه مبلغی
    const amount = Number(pay.amount) || 0;
    if (paymentFilters.minAmount !== null && !isNaN(paymentFilters.minAmount)) {
      if (amount < paymentFilters.minAmount) return false;
    }
    if (paymentFilters.maxAmount !== null && !isNaN(paymentFilters.maxAmount)) {
      if (amount > paymentFilters.maxAmount) return false;
    }
    // 3. جستجوی نام
    if (nameQuery) {
      const payer = (pay.payer_name || '').toLowerCase();
      if (!payer.includes(nameQuery)) return false;
    }
    // 4. جستجوی کد پیگیری
    if (trackQuery) {
      const track = window.CampaignDB.toEnglishDigits(pay.tracking_code || '').toUpperCase();
      if (!track.includes(trackQuery)) return false;
    }
    // 5. جستجوی شماره همراه
    if (phoneQuery) {
      const phone = window.CampaignDB.toEnglishDigits(pay.phone || '');
      if (!phone.includes(phoneQuery)) return false;
    }
    return true;
  });
}

function renderPaymentsTable() {
  const tbody = document.getElementById('paymentsTableBody');
  if (!tbody) return;
  const filtered = getFilteredPayments();
  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 32px; color: #94a3b8;">تراکنشی با مشخصات فیلترشده یافت نشد.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(pay => {
    const camp = allCampaigns.find(c => String(c.id) === String(pay.campaign_id));
    const dateFormatted = pay.created_at ? new Date(pay.created_at).toLocaleDateString('fa-IR') : '-';
    return `
      <tr>
        <td style="font-weight: 700; color: #047857;">${pay.tracking_code}</td>
        <td style="font-weight: 700;">
          <span>${pay.payer_name || 'ناشناس'}</span>
          ${pay.is_anonymous ? '<span style="font-size: 0.72rem; background: #e0f2fe; color: #0369a1; padding: 2px 7px; border-radius: 6px; margin-right: 6px; font-weight: 600; display: inline-block;">گمنام در سایت</span>' : ''}
        </td>
        <td><span style="direction: ltr; display: inline-block;">${window.CampaignDB.toPersianDigits(pay.phone || '-')}</span></td>
        <td>${camp ? camp.title : 'نامشخص'}</td>
        <td style="font-weight: 800; color: #047857;">${window.CampaignDB.toPersianDigits(pay.shares)}</td>
        <td style="font-weight: 700;">${window.CampaignDB.formatCurrency(pay.amount)}</td>
        <td style="font-size: 0.8rem; color: #64748b;">${window.CampaignDB.toPersianDigits(dateFormatted)}</td>
        <td><span class="badge-status ${pay.status}">${getPaymentStatusPersianLabel(pay.status)}</span></td>
        <td>
          <div class="table-actions-cell">
            ${(pay.status !== 'successful' && pay.status !== 'success') ? `<button type="button" class="btn-row-action btn-action-status" onclick="setPaymentStatus('${pay.id}', 'successful')">تایید دستی</button>` : ''}
            ${pay.status !== 'cancelled' ? `<button type="button" class="btn-row-action" style="color: #d97706;" onclick="setPaymentStatus('${pay.id}', 'cancelled')">لغو</button>` : ''}
            <button type="button" class="btn-row-action btn-action-edit" onclick="openEditPaymentModal('${pay.id}')">ویرایش</button>
            <button type="button" class="btn-row-action btn-action-delete" onclick="confirmDeletePayment('${pay.id}')">حذف</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function exportPaymentsToExcel() {
  const filtered = getFilteredPayments();
  if (filtered.length === 0) {
    showAdminToast('تراکنشی برای خروجی اکسل وجود ندارد.', 'warning');
    return;
  }
  if (typeof window.XLSX === 'undefined') {
    showAdminToast('کتابخانه اکسل بارگذاری نشده است.', 'error');
    return;
  }

  const exportData = filtered.map(p => {
    const camp = allCampaigns.find(c => String(c.id) === String(p.campaign_id));
    const createdDate = p.created_at ? new Date(p.created_at).toLocaleDateString('fa-IR') : '-';
    const verifiedDate = p.verified_at ? new Date(p.verified_at).toLocaleDateString('fa-IR') : ((p.status === 'successful' || p.status === 'success') ? createdDate : '-');
    return {
      'نام واریز کننده': p.payer_name || 'ناشناس',
      'شماره تماس': p.phone || '-',
      'مبلغ (تومان)': Number(p.amount) || 0,
      'تعداد سهم': Number(p.shares) || 1,
      'عنوان پویش': camp ? camp.title : 'نامشخص',
      'وضعیت تراکنش': getPaymentStatusPersianLabel(p.status),
      'کد پیگیری': p.tracking_code || '-',
      'شماره ارجاع بانک': p.transaction_id || p.authority_token || '-',
      'تاریخ تایید': verifiedDate,
      'تاریخ ثبت': createdDate,
      'توضیحات و نیت': p.description || ''
    };
  });

  const worksheet = window.XLSX.utils.json_to_sheet(exportData);
  const workbook = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(workbook, worksheet, 'پرداخت‌ها');
  const fileName = `گزارش_پرداخت‌های_پویش_${new Date().toISOString().slice(0, 10)}.xlsx`;
  window.XLSX.writeFile(workbook, fileName);
  showAdminToast(`فایل اکسل با ${window.CampaignDB.toPersianDigits(filtered.length)} رکورد دریافت شد.`, 'success');
}

window.setPaymentStatus = async function(paymentId, newStatus) {
  await window.CampaignDB.updatePayment(paymentId, { status: newStatus });
  await reloadAdminData();
  await reloadNotifications();
  renderPaymentsTable();
  renderDashboard();
  showAdminToast(`وضعیت تراکنش به ${getPaymentStatusPersianLabel(newStatus)} تغییر یافت.`, 'success');
};

window.confirmDeletePayment = async function(paymentId) {
  const pay = allPayments.find(p => String(p.id) === String(paymentId));
  const donorName = pay ? (pay.donor_name || pay.payer_name || 'تراکنش') : 'تراکنش';
  const amountStr = pay && pay.amount ? `${window.CampaignDB.formatNumber(pay.amount)} تومان` : '';
  const ok = await showAdminConfirm({
    title: 'تایید حذف تراکنش',
    message: `آیا از حذف رکورد پرداخت «${donorName}»${amountStr ? ` به مبلغ ${amountStr}` : ''} اطمینان دارید؟`,
    subtext: 'این تراکنش به زباله‌دان منتقل خواهد شد و در صورت لزوم قابل بازیابی است.',
    confirmText: 'بله، حذف پرداخت',
    danger: true
  });
  if (ok) {
    await executeDeletePayment(paymentId);
  }
};

async function executeDeletePayment(paymentId) {
  try {
    const res = await window.CampaignDB.deletePayment(paymentId);
    await reloadAdminData();
    await reloadNotifications();
    renderPaymentsTable();
    renderDashboard();
    showAdminToast(res?.message || 'پرداخت با موفقیت به زباله‌دان منتقل شد.', 'success');
  } catch (err) {
    showAdminToast(err.message || 'خطا در حذف پرداخت.', 'error');
  }
}
window.executeDeletePayment = executeDeletePayment;

window.openAddPaymentModal = function() {
  editingPaymentId = null;
  const form = document.getElementById('formManualPayment');
  if (form) form.reset();
  const select = document.getElementById('manualPaymentCampaignSelect');
  select.innerHTML = allCampaigns.map(c => `
    <option value="${c.id}" data-price="${c.share_price}">${c.title} (قیمت هر سهم: ${window.CampaignDB.formatCurrency(c.share_price)})</option>
  `).join('');
  document.getElementById('manualPaymentTrackingCode').value = 'TRK-' + Math.floor(100000 + Math.random() * 900000);
  document.getElementById('manualPaymentShares').value = '1';
  updateManualPaymentAmount();
  document.getElementById('modalManualPaymentTitle').textContent = 'ثبت پرداخت دستی / حضوری';
  document.getElementById('modalManualPayment').classList.add('open');
};

function updateManualPaymentAmount() {
  const select = document.getElementById('manualPaymentCampaignSelect');
  const selectedOption = select ? select.options[select.selectedIndex] : null;
  const sharePrice = selectedOption ? Number(selectedOption.getAttribute('data-price')) || 50000 : 50000;
  const shares = parseInt(window.CampaignDB.toEnglishDigits(document.getElementById('manualPaymentShares')?.value), 10) || 1;
  const amtEl = document.getElementById('manualPaymentAmount');
  if (amtEl) amtEl.value = shares * sharePrice;
}

window.openEditPaymentModal = function(paymentId) {
  const pay = allPayments.find(p => String(p.id) === String(paymentId));
  if (!pay) return;
  editingPaymentId = pay.id;

  const select = document.getElementById('manualPaymentCampaignSelect');
  select.innerHTML = allCampaigns.map(c => `
    <option value="${c.id}" data-price="${c.share_price}" ${String(c.id) === String(pay.campaign_id) ? 'selected' : ''}>
      ${c.title}
    </option>
  `).join('');

  document.getElementById('manualPaymentPayerName').value = pay.payer_name || 'ناشناس';
  document.getElementById('manualPaymentPhone').value = pay.phone || '';
  document.getElementById('manualPaymentShares').value = pay.shares;
  document.getElementById('manualPaymentAmount').value = pay.amount;
  document.getElementById('manualPaymentTrackingCode').value = pay.tracking_code;
  document.getElementById('manualPaymentDesc').value = pay.description || '';
  document.getElementById('manualPaymentStatus').value = pay.status;

  document.getElementById('modalManualPaymentTitle').textContent = 'ویرایش تراکنش پرداخت';
  document.getElementById('modalManualPayment').classList.add('open');
};

function renderReports() {
  const tbody = document.getElementById('reportsCampaignsTableBody');
  if (!tbody) return;
  tbody.innerHTML = allCampaigns.map(camp => {
    const stats = window.CampaignDB.calculateCampaignStats(camp, allPayments);
    return `
      <tr>
        <td style="font-weight: 800; color: #0f172a;">${camp.title}</td>
        <td>${window.CampaignDB.formatNumber(stats.total_shares)}</td>
        <td style="color: #047857; font-weight: 700;">${window.CampaignDB.formatNumber(stats.paid_shares)}</td>
        <td style="color: #d97706; font-weight: 700;">${window.CampaignDB.formatNumber(stats.remaining_shares)}</td>
        <td>${window.CampaignDB.formatCurrency(stats.target_amount)}</td>
        <td style="color: #047857; font-weight: 800;">${window.CampaignDB.formatCurrency(stats.collected_amount)}</td>
        <td style="color: #64748b;">${window.CampaignDB.formatCurrency(stats.remaining_amount)}</td>
        <td><strong style="color: #047857;">${window.CampaignDB.toPersianDigits(stats.progress)}٪</strong></td>
        <td>${window.CampaignDB.formatNumber(stats.total_payments_count)}</td>
        <td>${window.CampaignDB.formatNumber(stats.participants_count)} نفر</td>
      </tr>
    `;
  }).join('');

  const successCount = allPayments.filter(p => p.status === 'successful' || p.status === 'success').length;
  const pendingCount = allPayments.filter(p => p.status === 'pending').length;
  const cancelledCount = allPayments.filter(p => p.status === 'cancelled' || p.status === 'failed').length;

  const scEl = document.getElementById('reportCountSuccessful');
  if (scEl) scEl.textContent = window.CampaignDB.formatNumber(successCount);
  const pcEl = document.getElementById('reportCountPending');
  if (pcEl) pcEl.textContent = window.CampaignDB.formatNumber(pendingCount);
  const ccEl = document.getElementById('reportCountCancelled');
  if (ccEl) ccEl.textContent = window.CampaignDB.formatNumber(cancelledCount);
}

async function renderSettings() {
  const apiBase = (window.APP_CONFIG && window.APP_CONFIG.apiBaseUrl) || window.API_BASE_URL || '/api';
  const uploadsBase = (window.APP_CONFIG && window.APP_CONFIG.uploadsBaseUrl) || '/uploads/campaigns';

  const apiEl = document.getElementById('settingsApiUrl');
  if (apiEl) apiEl.value = apiBase;
  const uploadsEl = document.getElementById('settingsUploadsUrl');
  if (uploadsEl) uploadsEl.value = uploadsBase;

  const sqlBlock = document.getElementById('mysqlSqlCodeDisplay') || document.getElementById('supabaseSqlCodeDisplay');
  if (sqlBlock && typeof window.CampaignDB.getMySQLScript === 'function') {
    sqlBlock.textContent = window.CampaignDB.getMySQLScript();
  }

  try {
    const gwSettings = await window.CampaignDB.getPaymentSettings();
    const selGw = document.getElementById('settingActiveGateway');
    const selEnabled = document.getElementById('settingGatewayEnabled');
    const chkSandbox = document.getElementById('settingGatewaySandbox');
    const txtMerchant = document.getElementById('settingGatewayMerchantId');
    const txtApiKey = document.getElementById('settingGatewayApiKey');
    const txtTerminal = document.getElementById('settingGatewayTerminalId');

    if (selGw) selGw.value = gwSettings.active_gateway || 'test_gateway';
    if (selEnabled) selEnabled.value = String(gwSettings.is_active !== false);
    if (chkSandbox) chkSandbox.checked = gwSettings.sandbox !== false;
    if (txtMerchant) txtMerchant.value = gwSettings.merchant_id || '';
    if (txtApiKey) txtApiKey.value = gwSettings.api_key || '';
    if (txtTerminal) txtTerminal.value = gwSettings.terminal_id || '';

    const txtNotice = document.getElementById('settingHomepageNotice');
    const txtCopyright = document.getElementById('settingFooterCopyright');
    const txtVersion = document.getElementById('settingSystemVersion');

    if (txtNotice) txtNotice.value = gwSettings.homepage_notice_text || 'نذر و مشارکت‌های شما به صورت مستقیم و شفاف در این پویش ثبت شده و امکان رهگیری لحظه‌ای با کد پیگیری اختصاصی فراهم است.';
    if (txtCopyright) txtCopyright.value = gwSettings.footer_copyright_text || '© ۱۴۰۵ تمامی حقوق این وبسایت محفوظ است';
    if (txtVersion) txtVersion.value = gwSettings.system_version_text || 'V1.1';

    updateGatewayBadge(gwSettings.is_active);
    updateGatewayFieldsDisplay(gwSettings.active_gateway);
  } catch (err) {
    console.error('خطا در بارگذاری تنظیمات درگاه:', err);
  }

  // بارگذاری متن قوانین و مقررات
  try {
    const termsContent = await window.CampaignDB.getTermsContent();
    const txtTerms = document.getElementById('settingTermsContent');
    const previewTerms = document.getElementById('termsPreviewContainer');
    const badgeUnsaved = document.getElementById('termsUnsavedBadge');
    if (txtTerms) {
      txtTerms.value = termsContent || '';
      termsInitialContent = termsContent || '';
      termsIsDirty = false;
    }
    if (previewTerms) {
      previewTerms.innerHTML = termsContent || '<div style="color: #94a3b8; text-align: center;">متنی ثبت نشده است.</div>';
    }
    if (badgeUnsaved) {
      badgeUnsaved.style.display = 'none';
    }
  } catch (err) {
    console.warn('خطا در دریافت قوانین و مقررات:', err);
  }
}

function updateGatewayBadge(isActive) {
  const badge = document.getElementById('gatewayActiveStatusBadge');
  const txt = document.getElementById('gatewayActiveStatusText');
  if (!badge || !txt) return;
  if (isActive) {
    badge.style.background = '#ecfdf5';
    badge.style.color = '#047857';
    badge.querySelector('span:first-child').style.background = '#10b981';
    txt.textContent = 'درگاه فعال است';
  } else {
    badge.style.background = '#fff1f2';
    badge.style.color = '#be123c';
    badge.querySelector('span:first-child').style.background = '#e11d48';
    txt.textContent = 'درگاه غیرفعال است';
  }
}

function updateGatewayFieldsDisplay(gatewayType) {
  const labelMerchant = document.getElementById('labelGatewayMerchantId');
  const groupApiKey = document.getElementById('groupGatewayApiKey');
  const groupTerminal = document.getElementById('groupGatewayTerminalId');

  if (gatewayType === 'zarinpal') {
    if (labelMerchant) labelMerchant.textContent = 'کد مرچنت زرین‌پال (Merchant ID - ۳۶ کاراکتر)';
    if (groupApiKey) groupApiKey.style.display = 'none';
    if (groupTerminal) groupTerminal.style.display = 'none';
  } else if (gatewayType === 'idpay') {
    if (labelMerchant) labelMerchant.textContent = 'کلید API آیدی پی (API Key)';
    if (groupApiKey) groupApiKey.style.display = 'block';
    if (groupTerminal) groupTerminal.style.display = 'none';
  } else if (gatewayType === 'zibal') {
    if (labelMerchant) labelMerchant.textContent = 'کد مرچنت زیبال (Merchant ID)';
    if (groupApiKey) groupApiKey.style.display = 'none';
    if (groupTerminal) groupTerminal.style.display = 'none';
  } else if (gatewayType === 'nextpay') {
    if (labelMerchant) labelMerchant.textContent = 'کلید API نکست پی (API Key)';
    if (groupApiKey) groupApiKey.style.display = 'none';
    if (groupTerminal) groupTerminal.style.display = 'none';
  } else {
    if (labelMerchant) labelMerchant.textContent = 'کد مرچنت آزمایشی';
    if (groupApiKey) groupApiKey.style.display = 'block';
    if (groupTerminal) groupTerminal.style.display = 'none';
  }
}

// ==============================================================================
// ۵. بخش کاربران (Users Management)
// ==============================================================================
async function renderUsersSection() {
  const tbody = document.getElementById('usersTableBody');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 32px; color: #64748b;">در حال دریافت اطلاعات کاربران...</td></tr>`;

  try {
    const res = await window.CampaignDB.getUsers(userFilters);
    const users = res.data || [];
    const stats = res.stats || {};

    const statTotal = document.getElementById('usersStatTotal');
    const statActive = document.getElementById('usersStatActive');
    const statAnonymous = document.getElementById('usersStatAnonymous');
    const statTotalAmount = document.getElementById('usersStatTotalAmount');

    if (statTotal) statTotal.textContent = window.CampaignDB.toPersianDigits(stats.total_users || 0);
    if (statActive) statActive.textContent = window.CampaignDB.toPersianDigits(stats.active_participants || 0);
    if (statAnonymous) statAnonymous.textContent = window.CampaignDB.toPersianDigits(stats.anonymous_users || 0);
    if (statTotalAmount) statTotalAmount.textContent = window.CampaignDB.formatCurrency(stats.total_paid_amount || 0);

    if (users.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 36px; color: #94a3b8;">کاربری با مشخصات جستجو شده یافت نشد.</td></tr>`;
      renderUsersPagination(0, 1, userFilters.limit || 10);
      return;
    }

    const startIndex = ((res.page || 1) - 1) * (res.limit || 10);

    tbody.innerHTML = users.map((u, idx) => {
      const rowNum = window.CampaignDB.toPersianDigits(startIndex + idx + 1);
      const regDate = u.created_at ? window.CampaignDB.toPersianDigits(new Date(u.created_at).toLocaleDateString('fa-IR')) : '-';
      const totalAmt = window.CampaignDB.formatCurrency(u.total_amount || 0);

      let anonBadge = u.is_anonymous ? '<span class="badge-status anonymous">گمنام</span>' : '<span class="badge-status public_name">با نام</span>';

      return `
        <tr>
          <td style="font-weight: 700; color: #64748b;">${rowNum}</td>
          <td style="font-weight: 800; color: #0f172a;">
            <div>${u.name || 'بی‌نام'}</div>
            ${u.is_anonymous ? '<span class="badge-anon-pill">درخواست گمنامی</span>' : ''}
          </td>
          <td>
            <span style="direction: ltr; display: inline-block; font-family: inherit;">${window.CampaignDB.toPersianDigits(u.phone || '-')}</span>
          </td>
          <td style="font-size: 0.84rem; color: #64748b;">${regDate}</td>
          <td>
            <span class="badge-status successful">موفق</span>
          </td>
          <td>${anonBadge}</td>
          <td style="font-weight: 800; color: #047857;">${totalAmt}</td>
          <td>
            <div class="table-actions-cell">
              <button type="button" class="btn-row-action" style="color: #0284c7;" onclick="openUserDetailsModal('${u.id}')" title="مشاهده جزئیات">
                مشاهده جزئیات
              </button>
              <button type="button" class="btn-row-action btn-action-delete" onclick="confirmDeleteUser('${u.id}', '${(u.name || '').replace(/'/g, "\\'")}')" title="حذف کاربر">
                حذف
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    renderUsersPagination(res.total || 0, res.page || 1, res.limit || 10);
  } catch (err) {
    console.error('خطا در بارگذاری کاربران:', err);
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 24px; color: #dc2626;">خطا در دریافت لیست کاربران: ${err.message}</td></tr>`;
  }
}

function renderUsersPagination(total, currentPage, limit) {
  const infoEl = document.getElementById('usersPaginationInfo');
  const controlsEl = document.getElementById('usersPaginationControls');
  if (!infoEl || !controlsEl) return;

  const totalPages = Math.ceil(total / limit) || 1;
  const start = total === 0 ? 0 : (currentPage - 1) * limit + 1;
  const end = Math.min(currentPage * limit, total);

  infoEl.textContent = `نمایش ${window.CampaignDB.toPersianDigits(start)} تا ${window.CampaignDB.toPersianDigits(end)} از مجموع ${window.CampaignDB.toPersianDigits(total)} کاربر`;

  let html = '';
  html += `
    <button type="button" class="btn-page-nav" ${currentPage <= 1 ? 'disabled' : ''} onclick="goToUsersPage(${currentPage - 1})">
      صفحه قبلی
    </button>
    <span class="page-indicator-pill">صفحه ${window.CampaignDB.toPersianDigits(currentPage)} از ${window.CampaignDB.toPersianDigits(totalPages)}</span>
    <button type="button" class="btn-page-nav" ${currentPage >= totalPages ? 'disabled' : ''} onclick="goToUsersPage(${currentPage + 1})">
      صفحه بعدی
    </button>
  `;
  controlsEl.innerHTML = html;
}

window.goToUsersPage = function(page) {
  userFilters.page = page;
  renderUsersSection();
};

async function exportUsersToExcel() {
  const exportBtn = document.getElementById('btnExportUsersExcel');
  const origHtml = exportBtn ? exportBtn.innerHTML : '';
  if (exportBtn) {
    exportBtn.disabled = true;
    exportBtn.innerHTML = '<span>در حال ایجاد فایل...</span>';
  }

  try {
    const exportParams = {
      ...userFilters,
      page: 1,
      limit: 10000
    };
    const res = await window.CampaignDB.getUsers(exportParams);
    const users = res.data || [];

    if (users.length === 0) {
      showAdminToast('کاربری برای خروجی اکسل یافت نشد.', 'warning');
      return;
    }

    // الزامات مهم: فایل اکسل خروجی باید فقط و فقط شامل این ۳ ستون باشد:
    // 1. نام و نام خانوادگی
    // 2. تاریخ عضویت
    // 3. شماره تلفن همراه
    const exportRows = users.map(u => ({
      'نام و نام خانوادگی': u.name || 'بی‌نام',
      'تاریخ عضویت': u.created_at ? new Date(u.created_at).toLocaleDateString('fa-IR') : '-',
      'شماره تلفن همراه': u.phone || '-'
    }));

    if (typeof window.XLSX !== 'undefined') {
      const ws = window.XLSX.utils.json_to_sheet(exportRows);
      const wb = window.XLSX.utils.book_new();
      window.XLSX.utils.book_append_sheet(wb, ws, 'کاربران');
      const fileName = `لیست_کاربران_پویش_${new Date().toISOString().slice(0, 10)}.xlsx`;
      window.XLSX.writeFile(wb, fileName);
      showAdminToast(`فایل اکسل با ${window.CampaignDB.toPersianDigits(users.length)} کاربر دریافت شد.`, 'success');
    } else {
      const query = new URLSearchParams();
      query.set('action', 'export');
      if (userFilters.search) query.set('search', userFilters.search);
      if (userFilters.status) query.set('status', userFilters.status);
      if (userFilters.from_date) query.set('from_date', userFilters.from_date);
      if (userFilters.to_date) query.set('to_date', userFilters.to_date);
      window.location.href = `/api/users?${query.toString()}`;
      showAdminToast('در حال دانلود فایل اکسل...', 'info');
    }
  } catch (err) {
    console.error('خطا در خروجی اکسل کاربران:', err);
    showAdminToast('خطا در ایجاد فایل اکسل: ' + err.message, 'error');
  } finally {
    if (exportBtn) {
      exportBtn.disabled = false;
      exportBtn.innerHTML = origHtml;
    }
  }
}

window.openUserDetailsModal = async function(userId) {
  const modal = document.getElementById('modalUserDetails');
  const bodyEl = document.getElementById('modalUserDetailsBody');
  const actionBtns = document.getElementById('modalUserActionButtons');
  if (!modal || !bodyEl) return;

  bodyEl.innerHTML = '<div style="text-align: center; padding: 32px; color: #64748b;">در حال دریافت اطلاعات کاربر...</div>';
  if (actionBtns) actionBtns.innerHTML = '';
  modal.classList.add('open');

  try {
    const user = await window.CampaignDB.getUserById(userId);
    const regDate = user.created_at ? window.CampaignDB.toPersianDigits(new Date(user.created_at).toLocaleString('fa-IR')) : '-';

    let statusLabel = 'در انتظار تأیید';
    if (user.status === 'approved') statusLabel = 'تأیید شده';
    else if (user.status === 'rejected') statusLabel = 'رد شده';

    const paymentsList = user.payments || [];
    let paymentsTableHtml = '';
    if (paymentsList.length > 0) {
      paymentsTableHtml = `
        <div style="margin-top: 20px;">
          <h4 style="font-size: 0.95rem; font-weight: 800; color: #0f172a; margin-bottom: 10px;">سوابق تراکنش‌های کاربر (${window.CampaignDB.toPersianDigits(paymentsList.length)} پرداخت)</h4>
          <div class="table-responsive" style="max-height: 240px; overflow-y: auto;">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>کد پیگیری</th>
                  <th>مبلغ (تومان)</th>
                  <th>تعداد سهم</th>
                  <th>وضعیت</th>
                  <th>تاریخ</th>
                  <th>شماره تراکنش</th>
                </tr>
              </thead>
              <tbody>
                ${paymentsList.map(p => `
                  <tr>
                    <td style="font-weight: 700; color: #047857;">${p.tracking_code || '-'}</td>
                    <td style="font-weight: 700;">${window.CampaignDB.formatCurrency(p.amount || 0)}</td>
                    <td>${window.CampaignDB.toPersianDigits(p.shares || 1)}</td>
                    <td><span class="badge-status ${p.status}">${getPaymentStatusPersianLabel(p.status)}</span></td>
                    <td style="font-size: 0.8rem;">${p.created_at ? window.CampaignDB.toPersianDigits(new Date(p.created_at).toLocaleDateString('fa-IR')) : '-'}</td>
                    <td style="direction: ltr; font-size: 0.8rem;">${p.transaction_id || '-'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    } else {
      paymentsTableHtml = '<div style="margin-top: 14px; font-size: 0.85rem; color: #94a3b8;">سوابق تراکنشی برای این کاربر ثبت نشده است.</div>';
    }

    bodyEl.innerHTML = `
      <div class="user-profile-grid">
        <div class="user-profile-unit">
          <div class="label">نام و نام خانوادگی</div>
          <div class="val">${user.name || 'بی‌نام'}</div>
        </div>
        <div class="user-profile-unit">
          <div class="label">شماره تلفن همراه</div>
          <div class="val" style="direction: ltr; text-align: right;">${window.CampaignDB.toPersianDigits(user.phone || '-')}</div>
        </div>
        <div class="user-profile-unit">
          <div class="label">تاریخ عضویت و پرداخت</div>
          <div class="val" style="font-size: 0.85rem;">${regDate}</div>
        </div>
        <div class="user-profile-unit">
          <div class="label">وضعیت پرداخت</div>
          <div class="val" style="color: #047857;">پرداخت موفق و احراز شده</div>
        </div>
        <div class="user-profile-unit">
          <div class="label">نوع مشارکت (گمنامی)</div>
          <div class="val">${user.is_anonymous ? 'گمنام در سایت عمومی' : 'نمایش با نام واقعی'}</div>
        </div>
        <div class="user-profile-unit">
          <div class="label">مجموع مبلغ پرداختی</div>
          <div class="val" style="color: #0891b2;">${window.CampaignDB.formatCurrency(user.total_amount || 0)}</div>
        </div>
        <div class="user-profile-unit">
          <div class="label">تعداد مشارکت‌ها</div>
          <div class="val">${window.CampaignDB.toPersianDigits(user.payments_count || 1)} تراکنش</div>
        </div>
      </div>
      ${paymentsTableHtml}
    `;

    if (actionBtns) {
      actionBtns.innerHTML = `
        <button type="button" class="btn-quick-action btn-action-delete" onclick="confirmDeleteUser('${user.id}', '${(user.name || '').replace(/'/g, "\\'")}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          <span>حذف کاربر</span>
        </button>
      `;
    }
  } catch (err) {
    bodyEl.innerHTML = `<div style="color: #dc2626; padding: 20px;">خطا در دریافت مشخصات کاربر: ${err.message}</div>`;
  }
};

window.confirmDeleteUser = async function(userId, userName) {
  const ok = await showAdminConfirm({
    title: 'تایید حذف کاربر',
    message: `آیا از حذف کاربر «${userName || ''}» اطمینان دارید؟`,
    subtext: 'مشخصات این کاربر به زباله‌دان سیستم منتقل خواهد شد و در صورت نیاز قابل بازیابی است.',
    confirmText: 'بله، حذف کاربر',
    danger: true
  });
  if (ok) {
    await executeDeleteUser(userId);
  }
};

async function executeDeleteUser(userId) {
  try {
    const res = await window.CampaignDB.deleteUser(userId);
    showAdminToast(res?.message || 'کاربر با موفقیت به زباله‌دان منتقل گردید.', 'success');
    await reloadAdminData();
    await reloadNotifications();
    renderUsersSection();
    const modal = document.getElementById('modalUserDetails');
    if (modal) modal.classList.remove('open');
  } catch (err) {
    showAdminToast(err.message || 'خطا در حذف کاربر', 'error');
  }
}
window.executeDeleteUser = executeDeleteUser;

// ==============================================================================
// ۶. مدیریت لاگ‌ها و رویدادهای سیستم (Audit Logs Management)
// ==============================================================================
async function renderLogsSection() {
  const tbody = document.getElementById('logsTableBody');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 32px; color: #64748b;">در حال دریافت لاگ‌های سیستم...</td></tr>`;

  try {
    const res = await window.CampaignDB.getLogs(logFilters);
    const logs = res.data || [];

    if (logs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 36px; color: #94a3b8;">هیچ رخدادی با مشخصات فیلتر شده ثبت نشده است.</td></tr>`;
      renderLogsPagination(0, 1, logFilters.limit || 15);
      return;
    }

    const startIndex = ((res.page || 1) - 1) * (res.limit || 15);

    tbody.innerHTML = logs.map((l, idx) => {
      const rowNum = window.CampaignDB.toPersianDigits(startIndex + idx + 1);
      const timeStr = l.created_at ? window.CampaignDB.toPersianDigits(new Date(l.created_at).toLocaleString('fa-IR')) : '-';

      let actionClass = 'badge-log-action settings';
      if (l.action_type.includes('پرداخت')) actionClass = 'badge-log-action payment';
      else if (l.action_type.includes('کاربر')) actionClass = 'badge-log-action user';
      else if (l.action_type.includes('پویش')) actionClass = 'badge-log-action campaign';
      else if (l.action_type.includes('ورود')) actionClass = 'badge-log-action auth';
      else if (l.action_type.includes('قوانین')) actionClass = 'badge-log-action terms';
      else if (l.action_type.includes('لغو')) actionClass = 'badge-log-action undo';

      const statusBadge = (l.status === 'ناموفق' || l.status === 'failed') ?
        '<span class="badge-log-status failed">ناموفق</span>' :
        '<span class="badge-log-status success">موفق</span>';

      return `
        <tr>
          <td style="font-weight: 700; color: #64748b;">${rowNum}</td>
          <td style="font-size: 0.82rem; color: #475569; white-space: nowrap;">${timeStr}</td>
          <td><span class="${actionClass}">${l.action_type}</span></td>
          <td style="font-weight: 600; color: #0f172a;">${l.actor || 'سیستم'}</td>
          <td style="color: #0284c7; font-weight: 700;">${l.target || '-'}</td>
          <td style="font-size: 0.85rem; color: #334155; line-height: 1.6;">${l.description || '-'}</td>
          <td>${statusBadge}</td>
        </tr>
      `;
    }).join('');

    renderLogsPagination(res.total || 0, res.page || 1, res.limit || 15);
  } catch (err) {
    console.error('خطا در بارگذاری لاگ‌ها:', err);
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 24px; color: #dc2626;">خطا در دریافت لاگ‌ها: ${err.message}</td></tr>`;
  }
}

function renderLogsPagination(total, currentPage, limit) {
  const infoEl = document.getElementById('logsPaginationInfo');
  const controlsEl = document.getElementById('logsPaginationControls');
  if (!infoEl || !controlsEl) return;

  const totalPages = Math.ceil(total / limit) || 1;
  const start = total === 0 ? 0 : (currentPage - 1) * limit + 1;
  const end = Math.min(currentPage * limit, total);

  infoEl.textContent = `نمایش ${window.CampaignDB.toPersianDigits(start)} تا ${window.CampaignDB.toPersianDigits(end)} از مجموع ${window.CampaignDB.toPersianDigits(total)} رویداد`;

  let html = '';
  html += `
    <button type="button" class="btn-page-nav" ${currentPage <= 1 ? 'disabled' : ''} onclick="goToLogsPage(${currentPage - 1})">
      صفحه قبلی
    </button>
    <span class="page-indicator-pill">صفحه ${window.CampaignDB.toPersianDigits(currentPage)} از ${window.CampaignDB.toPersianDigits(totalPages)}</span>
    <button type="button" class="btn-page-nav" ${currentPage >= totalPages ? 'disabled' : ''} onclick="goToLogsPage(${currentPage + 1})">
      صفحه بعدی
    </button>
  `;
  controlsEl.innerHTML = html;
}

window.goToLogsPage = function(page) {
  logFilters.page = page;
  renderLogsSection();
};

// ==============================================================================
// ۷. ویرایشگر قوانین و مقررات پویش (Terms & Regulations Editor)
// ==============================================================================
function setupTermsEditorEvents() {
  const txtTerms = document.getElementById('settingTermsContent');
  const previewTerms = document.getElementById('termsPreviewContainer');
  const editorContainer = document.getElementById('termsEditorContainer');
  const toolbar = document.getElementById('termsToolbar');
  const badgeUnsaved = document.getElementById('termsUnsavedBadge');
  const btnTabEditor = document.getElementById('btnTabTermsEditor');
  const btnTabPreview = document.getElementById('btnTabTermsPreview');
  const btnSaveTerms = document.getElementById('btnSaveTermsContent');
  const btnCancelTerms = document.getElementById('btnCancelTermsContent');
  const btnResetTemplate = document.getElementById('btnTermsResetTemplate');

  if (txtTerms) {
    txtTerms.addEventListener('input', () => {
      termsIsDirty = (txtTerms.value !== termsInitialContent);
      if (badgeUnsaved) badgeUnsaved.style.display = termsIsDirty ? 'inline-block' : 'none';
      if (previewTerms) previewTerms.innerHTML = txtTerms.value || '<div style="color: #94a3b8; text-align: center;">متنی وارد نشده است.</div>';
    });
  }

  if (btnTabEditor && btnTabPreview && editorContainer && previewTerms && toolbar) {
    btnTabEditor.onclick = () => {
      btnTabEditor.classList.add('primary');
      btnTabEditor.style.background = '';
      btnTabEditor.style.color = '';
      btnTabPreview.classList.remove('primary');
      btnTabPreview.style.background = '#f1f5f9';
      btnTabPreview.style.color = '#475569';
      editorContainer.style.display = 'block';
      toolbar.style.display = 'flex';
      previewTerms.style.display = 'none';
    };

    btnTabPreview.onclick = () => {
      btnTabPreview.classList.add('primary');
      btnTabPreview.style.background = '';
      btnTabPreview.style.color = '';
      btnTabEditor.classList.remove('primary');
      btnTabEditor.style.background = '#f1f5f9';
      btnTabEditor.style.color = '#475569';
      editorContainer.style.display = 'none';
      toolbar.style.display = 'none';
      previewTerms.style.display = 'block';
      previewTerms.innerHTML = txtTerms?.value || '<div style="color: #94a3b8; text-align: center;">متنی وارد نشده است.</div>';
    };
  }

  document.querySelectorAll('.btn-terms-tool[data-tool]').forEach(btn => {
    btn.onclick = () => {
      if (!txtTerms) return;
      const tool = btn.getAttribute('data-tool');
      insertTextAtCursor(txtTerms, tool);
      txtTerms.dispatchEvent(new Event('input'));
    };
  });

  if (btnResetTemplate) {
    btnResetTemplate.onclick = async () => {
      const ok = await showAdminConfirm({
        title: 'بازنشانی قالب قوانین و مقررات',
        message: 'آیا مایل به بازنشانی متن قوانین به قالب استاندارد پیش‌فرض هستید؟',
        subtext: 'متن پیش‌فرض استاندارد جایگزین متن فعلی در کادر ویرایشگر خواهد شد.',
        confirmText: 'بله، بازنشانی شود',
        danger: false
      });
      if (ok) {
        const standardTemplate = `<h4>مقدمه و اهداف پویش</h4>
<p>این سامانه جهت تسهیل در جمع‌آوری نذورات و مشارکت‌های مردمی به صورت شفاف، سهم‌بندی شده و دقیق راه‌اندازی شده است. تمامی مبالغ واریزی منحصراً صرف اهداف اعلام‌شده در عنوان و توضیحات پویش می‌گردد.</p>
<h4>نکات مهم واریز وجه</h4>
<ul>
  <li>واریز وجه صرفاً از طریق شبکه رسمی شاپرک و درگاه‌های مجاز بانکی انجام می‌پذیرد.</li>
  <li>پس از تکمیل پرداخت، کد رهگیری یکتا نمایش داده شده و سهم شما در سامانه ثبت می‌شود.</li>
  <li>در صورت تمایل می‌توانید گزینه «میخواهم گمنام باشم» را فعال نمایید؛ در این حالت نام واقعی شما در امور مالی و سیستمی ثبت شده اما در سایت عمومی عنوان «گمنام» درج می‌گردد.</li>
  <li>در صورت بروز هرگونه قطعی شبکه، وجه کسر شده ظرف ۷۲ ساعت توسط شاپرک عودت داده می‌شود.</li>
</ul>
<div style="background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 10px; padding: 14px 16px; margin-top: 18px; margin-bottom: 18px; font-size: 0.85rem; color: #64748b;">
  <div style="font-weight: 700; color: #334155; margin-bottom: 4px;">پشتیبانی و ارتباط با مسئول پویش</div>
  <div>شماره تماس ثبت‌شده در پویش آماده پاسخگویی به سوالات مشارکت‌کنندگان محترم است.</div>
</div>`;
        if (txtTerms) {
          txtTerms.value = standardTemplate;
          txtTerms.dispatchEvent(new Event('input'));
        }
      }
    };
  }

  if (btnSaveTerms) {
    btnSaveTerms.onclick = async () => {
      const content = (txtTerms?.value || '').trim();
      if (!content) {
        showAdminToast('متن قوانین و مقررات نمی‌تواند خالی باشد.', 'error');
        txtTerms?.focus();
        return;
      }

      btnSaveTerms.disabled = true;
      const origHtml = btnSaveTerms.innerHTML;
      btnSaveTerms.innerHTML = '<span>در حال ذخیره...</span>';

      try {
        await window.CampaignDB.saveTermsContent(content);
        termsInitialContent = content;
        termsIsDirty = false;
        if (badgeUnsaved) badgeUnsaved.style.display = 'none';
        showAdminToast('قوانین و مقررات با موفقیت ذخیره و در سایت عمومی اعمال گردید.', 'success');
        await reloadNotifications();
      } catch (err) {
        console.error('خطا در ذخیره قوانین:', err);
        showAdminToast(err.message || 'خطا در ذخیره قوانین و مقررات', 'error');
      } finally {
        btnSaveTerms.disabled = false;
        btnSaveTerms.innerHTML = origHtml;
      }
    };
  }

  if (btnCancelTerms) {
    btnCancelTerms.onclick = () => {
      if (txtTerms) {
        txtTerms.value = termsInitialContent;
        termsIsDirty = false;
        if (badgeUnsaved) badgeUnsaved.style.display = 'none';
        if (previewTerms) previewTerms.innerHTML = termsInitialContent;
        showAdminToast('تغییرات ذخیره‌نشده لغو شد.', 'info');
      }
    };
  }
}

function insertTextAtCursor(textarea, tool) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const text = textarea.value;
  const selected = text.substring(start, end);

  let snippet = '';
  switch (tool) {
    case 'h4':
      snippet = `<h4>${selected || 'سرتیتر جدید'}</h4>\n`;
      break;
    case 'bold':
      snippet = `<strong>${selected || 'متن برجسته'}</strong>`;
      break;
    case 'list':
      snippet = `<ul>\n  <li>${selected || 'مورد اول'}</li>\n  <li>مورد دوم</li>\n</ul>\n`;
      break;
    case 'p':
      snippet = `<p>${selected || 'متن پاراگراف جدید...'}</p>\n`;
      break;
    case 'notice':
      snippet = `<div style="background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 10px; padding: 14px 16px; margin-top: 14px; font-size: 0.85rem; color: #64748b;">\n  <div style="font-weight: 700; color: #334155;">راهنما و پشتیبانی</div>\n  <div>${selected || 'توضیحات راهنما یا پاسخگویی...'}</div>\n</div>\n`;
      break;
  }

  textarea.value = text.substring(0, start) + snippet + text.substring(end);
  textarea.focus();
  textarea.setSelectionRange(start + snippet.length, start + snippet.length);
}

function setupAdminEvents() {
  document.querySelectorAll('[data-quick-action]').forEach(btn => {
    btn.onclick = () => {
      const action = btn.getAttribute('data-quick-action');
      if (action === 'add-campaign') {
        openAddCampaignModal();
      } else if (action === 'add-payment') {
        openAddPaymentModal();
      } else if (action === 'campaigns') {
        navigateToSection('campaigns');
      } else if (action === 'reports') {
        navigateToSection('reports');
      }
    };
  });

  const addSharesInput = document.getElementById('addCampTotalShares');
  const addPriceInput = document.getElementById('addCampSharePrice');
  if (addSharesInput && addPriceInput) {
    addSharesInput.oninput = updateAddCampaignCalculation;
    addPriceInput.oninput = updateAddCampaignCalculation;
  }

  const editSharesInput = document.getElementById('editCampTotalShares');
  const editPriceInput = document.getElementById('editCampSharePrice');
  if (editSharesInput && editPriceInput) {
    editSharesInput.oninput = () => {
      const s = parseInt(window.CampaignDB.toEnglishDigits(editSharesInput.value), 10) || 0;
      const p = parseInt(window.CampaignDB.toEnglishDigits(editPriceInput.value), 10) || 0;
      document.getElementById('editCampTargetAmountDisplay').textContent = window.CampaignDB.formatCurrency(s * p);
    };
    editPriceInput.oninput = () => {
      const s = parseInt(window.CampaignDB.toEnglishDigits(editSharesInput.value), 10) || 0;
      const p = parseInt(window.CampaignDB.toEnglishDigits(editPriceInput.value), 10) || 0;
      document.getElementById('editCampTargetAmountDisplay').textContent = window.CampaignDB.formatCurrency(s * p);
    };
  }

  // استانداردسازی فیلدهای شماره تماس در پنل ادمین (حداکثر ۱۱ رقم و شروع با ۰۹)
  const attachAdminPhoneNumberControl = (inputEl, hintEl) => {
    if (!inputEl) return;
    inputEl.setAttribute('maxlength', '11');

    const setError = (msg) => {
      inputEl.classList.add('phone-input-invalid');
      if (hintEl) {
        hintEl.textContent = msg;
        hintEl.style.display = 'block';
      }
      showAdminToast(msg, 'error');
    };

    const clearError = () => {
      inputEl.classList.remove('phone-input-invalid');
      if (hintEl) {
        hintEl.textContent = '';
        hintEl.style.display = 'none';
      }
    };

    // ۱. مسدود کردن ورود بیشتر از ۱۱ رقم و کاراکترهای غیرعددی با صفحه‌کلید
    inputEl.addEventListener('keydown', (e) => {
      if (
        e.key === 'Backspace' ||
        e.key === 'Delete' ||
        e.key === 'Tab' ||
        e.key === 'Escape' ||
        e.key === 'Enter' ||
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight' ||
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown' ||
        e.key === 'Home' ||
        e.key === 'End' ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey
      ) {
        return;
      }

      const isDigit = /^[0-9\u0660-\u0669\u06F0-\u06F9]$/.test(e.key);
      if (!isDigit) {
        e.preventDefault();
        return;
      }

      const selStart = inputEl.selectionStart ?? 0;
      const selEnd = inputEl.selectionEnd ?? 0;
      const currentSelectionLen = selEnd - selStart;
      const currentDigits = (window.CampaignDB ? window.CampaignDB.toEnglishDigits(inputEl.value) : inputEl.value).replace(/\D/g, '');
      if (currentDigits.length >= 11 && currentSelectionLen === 0) {
        e.preventDefault();
      }
    });

    // ۲. کنترل ورودی لحظه‌ای و صفحه‌کلیدهای مجازی در موبایل (beforeinput)
    inputEl.addEventListener('beforeinput', (e) => {
      if (e.data && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const engData = window.CampaignDB ? window.CampaignDB.toEnglishDigits(e.data) : e.data;
        const dataDigits = engData.replace(/\D/g, '');
        if (dataDigits.length === 0) {
          e.preventDefault();
          return;
        }
        const selStart = inputEl.selectionStart ?? 0;
        const selEnd = inputEl.selectionEnd ?? 0;
        const currentVal = (window.CampaignDB ? window.CampaignDB.toEnglishDigits(inputEl.value) : inputEl.value).replace(/\D/g, '');
        const currentLen = currentVal.length;
        const selectedLen = selEnd - selStart;
        if (currentLen - selectedLen + dataDigits.length > 11) {
          e.preventDefault();
        }
      }
    });

    // ۳. کنترل عملیات Paste
    inputEl.addEventListener('paste', (e) => {
      e.preventDefault();
      const pasted = (e.clipboardData || window.clipboardData)?.getData('text') || '';
      const eng = window.CampaignDB ? window.CampaignDB.toEnglishDigits(pasted) : pasted;
      const pastedDigits = eng.replace(/\D/g, '');

      const currentVal = window.CampaignDB ? window.CampaignDB.toEnglishDigits(inputEl.value) : inputEl.value;
      const start = inputEl.selectionStart ?? 0;
      const end = inputEl.selectionEnd ?? 0;
      const combined = currentVal.slice(0, start) + pastedDigits + currentVal.slice(end);
      const clean = combined.replace(/\D/g, '').slice(0, 11);

      inputEl.value = clean;
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // ۳. بررسی لحظه‌ای: اگر اول شماره با ۰۹ شروع نشده به کاربر بگوید فرمت شماره تماس اشتباه است
    let lastToastError = '';
    inputEl.addEventListener('input', () => {
      let raw = inputEl.value;
      let digits = window.CampaignDB ? window.CampaignDB.toEnglishDigits(raw) : raw;
      digits = digits.replace(/\D/g, '');
      if (digits.length > 11) {
        digits = digits.slice(0, 11);
      }
      inputEl.value = digits;

      if (digits.length > 0) {
        const isInvalid = (digits.length === 1 && digits[0] !== '0') || (digits.length >= 2 && !digits.startsWith('09'));
        if (isInvalid) {
          const msg = 'فرمت شماره تماس اشتباه است. شماره همراه باید با ۰۹ شروع شود.';
          inputEl.classList.add('phone-input-invalid');
          if (hintEl) {
            hintEl.textContent = msg;
            hintEl.style.display = 'block';
          }
          if (lastToastError !== msg) {
            showAdminToast(msg, 'error');
            lastToastError = msg;
          }
        } else {
          clearError();
          lastToastError = '';
        }
      } else {
        clearError();
        lastToastError = '';
      }
    });

    // ۴. بررسی خروج از فیلد
    inputEl.addEventListener('blur', () => {
      const val = inputEl.value.trim();
      const digits = (window.CampaignDB ? window.CampaignDB.toEnglishDigits(val) : val).replace(/\D/g, '');
      if (digits) {
        if (!digits.startsWith('09')) {
          setError('فرمت شماره تماس اشتباه است. شماره همراه باید با ۰۹ شروع شود.');
        } else if (digits.length !== 11) {
          setError('فرمت شماره تماس اشتباه است. شماره همراه باید ۱۱ رقم باشد.');
        } else {
          clearError();
        }
      } else {
        clearError();
      }
    });
  };

  attachAdminPhoneNumberControl(document.getElementById('addCampContactPhone'), document.getElementById('addCampContactPhoneErrorHint'));
  attachAdminPhoneNumberControl(document.getElementById('editCampContactPhone'), document.getElementById('editCampContactPhoneErrorHint'));
  attachAdminPhoneNumberControl(document.getElementById('manualPaymentPhone'), document.getElementById('manualPaymentPhoneErrorHint'));
  attachAdminPhoneNumberControl(document.getElementById('testSmsPhone'), document.getElementById('testSmsPhoneErrorHint'));

  const formAddCamp = document.getElementById('formAddCampaign');
  if (formAddCamp) {
    formAddCamp.onsubmit = async (e) => {
      e.preventDefault();
      const title = document.getElementById('addCampTitle').value.trim();
      const description = document.getElementById('addCampDesc').value.trim();
      const totalShares = parseInt(window.CampaignDB.toEnglishDigits(document.getElementById('addCampTotalShares').value), 10) || 100;
      const sharePrice = parseInt(window.CampaignDB.toEnglishDigits(document.getElementById('addCampSharePrice').value), 10) || 50000;
      const startDate = document.getElementById('addCampStartDate').value.trim();
      const endDate = document.getElementById('addCampEndDate').value.trim();
      const status = document.getElementById('addCampStatus').value || 'active';

      const eventLocation = document.getElementById('addCampEventLocation')?.value.trim() || '';
      const eventDate = document.getElementById('addCampEventDate')?.value.trim() || '';
      const eventTime = document.getElementById('addCampEventTime')?.value.trim() || '';
      const channelLink = document.getElementById('addCampChannelLink')?.value.trim() || '';
      const socialLink = document.getElementById('addCampSocialLink')?.value.trim() || '';
      const rawContactPhone = document.getElementById('addCampContactPhone')?.value.trim() || '';
      const additionalNotes = document.getElementById('addCampAdditionalNotes')?.value.trim() || '';

      const cleanContactPhone = rawContactPhone ? window.CampaignDB.toEnglishDigits(rawContactPhone).replace(/\D/g, '') : '';
      if (cleanContactPhone) {
        if (!cleanContactPhone.startsWith('09')) {
          showAdminToast('فرمت شماره تماس اشتباه است. شماره همراه باید با ۰۹ شروع شود.', 'error');
          document.getElementById('addCampContactPhone')?.focus();
          return;
        }
        if (cleanContactPhone.length !== 11) {
          showAdminToast('فرمت شماره تماس اشتباه است. شماره همراه باید دقیقاً ۱۱ رقم باشد.', 'error');
          document.getElementById('addCampContactPhone')?.focus();
          return;
        }
      }
      const contactPhone = cleanContactPhone;

      const submitBtn = document.getElementById('btnSaveCampaign');
      const originalText = submitBtn ? submitBtn.innerHTML : '';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span>در حال ذخیره...</span>';
      }

      try {
        let imageUrl = document.getElementById('addCampImageUrlInput')?.value.trim() || document.getElementById('addCampImage')?.value.trim() || '';
        if (selectedAddCampaignFile) {
          if (submitBtn) submitBtn.innerHTML = '<span>در حال آپلود تصویر...</span>';
          imageUrl = await window.CampaignDB.uploadCampaignImage(selectedAddCampaignFile);
          showAdminToast('تصویر بنر آپلود شد.', 'info');
        }

        if (submitBtn) submitBtn.innerHTML = '<span>در حال ثبت در دیتابیس...</span>';
        await window.CampaignDB.createCampaign({
          title,
          description,
          image_url: imageUrl,
          total_shares: totalShares,
          share_price: sharePrice,
          start_date: startDate,
          end_date: endDate,
          status,
          event_location: eventLocation,
          event_date: eventDate,
          event_time: eventTime,
          channel_link: channelLink,
          social_link: socialLink,
          contact_phone: contactPhone,
          additional_notes: additionalNotes
        });

        await reloadAdminData();
        await reloadNotifications();
        document.getElementById('modalAddCampaign')?.classList.remove('open');
        showAdminToast('پویش جدید با موفقیت ایجاد و منتشر گردید.', 'success');
        resetAddCampaignForm();
        renderCampaignsTable();
        renderDashboard();
        navigateToSection('campaigns');
      } catch (err) {
        console.error('خطای ثبت پویش:', err);
        showAdminToast(`خطا: ${err.message}`, 'error');
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = originalText || 'ذخیره و انتشار پویش';
        }
      }
    };
  }

  const formEditCamp = document.getElementById('formEditCampaign');
  if (formEditCamp) {
    formEditCamp.onsubmit = async (e) => {
      e.preventDefault();
      const title = document.getElementById('editCampTitle').value.trim();
      const description = document.getElementById('editCampDesc').value.trim();
      const totalShares = parseInt(window.CampaignDB.toEnglishDigits(document.getElementById('editCampTotalShares').value), 10) || 100;
      const sharePrice = parseInt(window.CampaignDB.toEnglishDigits(document.getElementById('editCampSharePrice').value), 10) || 50000;
      const startDate = document.getElementById('editCampStartDate').value.trim();
      const endDate = document.getElementById('editCampEndDate').value.trim();
      const status = document.getElementById('editCampStatus').value;

      const eventLocation = document.getElementById('editCampEventLocation')?.value.trim() || '';
      const eventDate = document.getElementById('editCampEventDate')?.value.trim() || '';
      const eventTime = document.getElementById('editCampEventTime')?.value.trim() || '';
      const channelLink = document.getElementById('editCampChannelLink')?.value.trim() || '';
      const socialLink = document.getElementById('editCampSocialLink')?.value.trim() || '';
      const rawContactPhone = document.getElementById('editCampContactPhone')?.value.trim() || '';
      const additionalNotes = document.getElementById('editCampAdditionalNotes')?.value.trim() || '';

      const cleanContactPhone = rawContactPhone ? window.CampaignDB.toEnglishDigits(rawContactPhone).replace(/\D/g, '') : '';
      if (cleanContactPhone) {
        if (!cleanContactPhone.startsWith('09')) {
          showAdminToast('فرمت شماره تماس اشتباه است. شماره همراه باید با ۰۹ شروع شود.', 'error');
          document.getElementById('editCampContactPhone')?.focus();
          return;
        }
        if (cleanContactPhone.length !== 11) {
          showAdminToast('فرمت شماره تماس اشتباه است. شماره همراه باید دقیقاً ۱۱ رقم باشد.', 'error');
          document.getElementById('editCampContactPhone')?.focus();
          return;
        }
      }
      const contactPhone = cleanContactPhone;

      const submitBtn = document.getElementById('btnSaveEditCampaign');
      const originalText = submitBtn ? submitBtn.innerHTML : '';
      if (submitBtn) submitBtn.disabled = true;

      try {
        let imageUrl = document.getElementById('editCampImageUrlInput')?.value.trim() || document.getElementById('editCampImage')?.value.trim() || '';
        if (selectedEditCampaignFile) {
          imageUrl = await window.CampaignDB.uploadCampaignImage(selectedEditCampaignFile);
          showAdminToast('تصویر جدید آپلود گردید.', 'info');
        }

        await window.CampaignDB.updateCampaign(editingCampaignId, {
          title,
          description,
          image_url: imageUrl,
          total_shares: totalShares,
          share_price: sharePrice,
          start_date: startDate,
          end_date: endDate,
          status,
          event_location: eventLocation,
          event_date: eventDate,
          event_time: eventTime,
          channel_link: channelLink,
          social_link: socialLink,
          contact_phone: contactPhone,
          additional_notes: additionalNotes
        });

        await reloadAdminData();
        await reloadNotifications();
        document.getElementById('modalEditCampaign').classList.remove('open');
        showAdminToast('تغییرات پویش با موفقیت ذخیره شد.', 'success');
        selectedEditCampaignFile = null;
        renderCampaignsTable();
        renderDashboard();
      } catch (err) {
        showAdminToast(`خطا: ${err.message}`, 'error');
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = originalText || 'ذخیره تغییرات پویش';
        }
      }
    };
  }

  const formManualPay = document.getElementById('formManualPayment');
  if (formManualPay) {
    const sharesInp = document.getElementById('manualPaymentShares');
    const campSel = document.getElementById('manualPaymentCampaignSelect');
    if (sharesInp) sharesInp.oninput = updateManualPaymentAmount;
    if (campSel) campSel.onchange = updateManualPaymentAmount;

    formManualPay.onsubmit = async (e) => {
      e.preventDefault();
      const campaignId = document.getElementById('manualPaymentCampaignSelect').value;
      const payerName = (document.getElementById('manualPaymentPayerName').value || 'ناشناس').trim();
      const rawPhone = document.getElementById('manualPaymentPhone').value.trim();
      const cleanPhone = rawPhone ? window.CampaignDB.toEnglishDigits(rawPhone).replace(/\D/g, '') : '';
      if (cleanPhone) {
        if (!cleanPhone.startsWith('09')) {
          showAdminToast('فرمت شماره تماس اشتباه است. شماره همراه باید با ۰۹ شروع شود.', 'error');
          document.getElementById('manualPaymentPhone')?.focus();
          return;
        }
        if (cleanPhone.length !== 11) {
          showAdminToast('فرمت شماره تماس اشتباه است. شماره همراه باید ۱۱ رقم باشد.', 'error');
          document.getElementById('manualPaymentPhone')?.focus();
          return;
        }
      }
      const phone = cleanPhone;
      const shares = parseInt(window.CampaignDB.toEnglishDigits(document.getElementById('manualPaymentShares').value), 10) || 1;
      const amount = parseInt(window.CampaignDB.toEnglishDigits(document.getElementById('manualPaymentAmount').value), 10) || 0;
      const trackingCode = document.getElementById('manualPaymentTrackingCode').value.trim();
      const description = document.getElementById('manualPaymentDesc').value.trim();
      const status = document.getElementById('manualPaymentStatus').value;

      try {
        if (editingPaymentId) {
          await window.CampaignDB.updatePayment(editingPaymentId, {
            campaign_id: campaignId,
            payer_name: payerName,
            phone,
            shares,
            amount,
            tracking_code: trackingCode,
            description,
            status
          });
          showAdminToast('تراکنش پرداخت بروزرسانی شد.', 'success');
        } else {
          await window.CampaignDB.createPayment({
            campaign_id: campaignId,
            payer_name: payerName,
            phone,
            shares,
            amount,
            tracking_code: trackingCode,
            description,
            status
          });
          showAdminToast('پرداخت جدید ثبت شد.', 'success');
        }

        await reloadAdminData();
        await reloadNotifications();
        document.getElementById('modalManualPayment').classList.remove('open');
        renderPaymentsTable();
        renderDashboard();
      } catch (err) {
        showAdminToast('خطا در ثبت پرداخت.', 'error');
      }
    };
  }

  const statusFilterEl = document.getElementById('paymentFilterStatus');
  const minAmountEl = document.getElementById('paymentFilterMinAmount');
  const maxAmountEl = document.getElementById('paymentFilterMaxAmount');
  const nameFilterEl = document.getElementById('paymentFilterName');
  const trackFilterEl = document.getElementById('paymentFilterTracking');
  const phoneFilterEl = document.getElementById('paymentFilterPhone');
  const btnResetFilters = document.getElementById('btnResetPaymentFilters');
  const btnExportExcel = document.getElementById('btnExportPaymentsExcel');

  if (statusFilterEl) {
    statusFilterEl.onchange = (e) => {
      paymentFilters.status = e.target.value;
      renderPaymentsTable();
    };
  }

  if (minAmountEl) {
    minAmountEl.oninput = (e) => {
      const raw = window.CampaignDB.toEnglishDigits(e.target.value).trim();
      paymentFilters.minAmount = (raw !== '' && !isNaN(Number(raw))) ? Number(raw) : null;
      renderPaymentsTable();
    };
  }

  if (maxAmountEl) {
    maxAmountEl.oninput = (e) => {
      const raw = window.CampaignDB.toEnglishDigits(e.target.value).trim();
      paymentFilters.maxAmount = (raw !== '' && !isNaN(Number(raw))) ? Number(raw) : null;
      renderPaymentsTable();
    };
  }

  document.querySelectorAll('[data-amount-range]').forEach(btn => {
    btn.onclick = (e) => {
      e.preventDefault();
      const range = btn.getAttribute('data-amount-range');
      if (range === 'all') {
        paymentFilters.minAmount = null;
        paymentFilters.maxAmount = null;
        if (minAmountEl) minAmountEl.value = '';
        if (maxAmountEl) maxAmountEl.value = '';
      } else if (range === '10k-200k') {
        paymentFilters.minAmount = 10000;
        paymentFilters.maxAmount = 200000;
        if (minAmountEl) minAmountEl.value = '10000';
        if (maxAmountEl) maxAmountEl.value = '200000';
      } else if (range === '200k-500k') {
        paymentFilters.minAmount = 200000;
        paymentFilters.maxAmount = 500000;
        if (minAmountEl) minAmountEl.value = '200000';
        if (maxAmountEl) maxAmountEl.value = '500000';
      } else if (range === '500k-plus') {
        paymentFilters.minAmount = 500000;
        paymentFilters.maxAmount = null;
        if (minAmountEl) minAmountEl.value = '500000';
        if (maxAmountEl) maxAmountEl.value = '';
      }
      renderPaymentsTable();
      showAdminToast('بازه مبلغی اعمال شد.', 'info');
    };
  });

  if (nameFilterEl) {
    nameFilterEl.oninput = (e) => {
      paymentFilters.name = e.target.value;
      renderPaymentsTable();
    };
  }
  if (trackFilterEl) {
    trackFilterEl.oninput = (e) => {
      paymentFilters.tracking = e.target.value;
      renderPaymentsTable();
    };
  }
  if (phoneFilterEl) {
    phoneFilterEl.setAttribute('maxlength', '11');
    phoneFilterEl.oninput = (e) => {
      let val = window.CampaignDB ? window.CampaignDB.toEnglishDigits(e.target.value) : e.target.value;
      val = val.replace(/\D/g, '').slice(0, 11);
      e.target.value = val;
      paymentFilters.phone = val;
      renderPaymentsTable();
    };
  }
  if (btnResetFilters) {
    btnResetFilters.onclick = () => {
      paymentFilters = { status: 'all', minAmount: null, maxAmount: null, name: '', tracking: '', phone: '' };
      if (statusFilterEl) statusFilterEl.value = 'all';
      if (minAmountEl) minAmountEl.value = '';
      if (maxAmountEl) maxAmountEl.value = '';
      if (nameFilterEl) nameFilterEl.value = '';
      if (trackFilterEl) trackFilterEl.value = '';
      if (phoneFilterEl) phoneFilterEl.value = '';
      renderPaymentsTable();
      showAdminToast('فیلترها ریست شدند.', 'info');
    };
  }
  if (btnExportExcel) {
    btnExportExcel.onclick = exportPaymentsToExcel;
  }

  const formGatewaySettings = document.getElementById('formPaymentGatewaySettings');
  const selectGateway = document.getElementById('settingActiveGateway');
  if (selectGateway) {
    selectGateway.onchange = (e) => {
      updateGatewayFieldsDisplay(e.target.value);
    };
  }
  if (formGatewaySettings) {
    formGatewaySettings.onsubmit = async (e) => {
      e.preventDefault();
      const active_gateway = document.getElementById('settingActiveGateway').value;
      const is_active = document.getElementById('settingGatewayEnabled').value === 'true';
      const sandbox = document.getElementById('settingGatewaySandbox').checked;
      const merchant_id = document.getElementById('settingGatewayMerchantId').value.trim();
      const api_key = document.getElementById('settingGatewayApiKey').value.trim();
      const terminal_id = document.getElementById('settingGatewayTerminalId').value.trim();

      const saveBtn = document.getElementById('btnSaveGatewaySettings');
      const origText = saveBtn ? saveBtn.innerHTML : '';
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<span>در حال ذخیره...</span>';
      }

      try {
        await window.CampaignDB.savePaymentSettings({
          active_gateway,
          is_active,
          sandbox,
          merchant_id,
          api_key,
          terminal_id
        });
        updateGatewayBadge(is_active);
        showAdminToast('تنظیمات درگاه بانکی با موفقیت ذخیره گردید.', 'success');
      } catch (err) {
        showAdminToast('خطا: ' + err.message, 'error');
      } finally {
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.innerHTML = origText || 'ذخیره تنظیمات درگاه';
        }
      }
    };
  }

  const formContentSettings = document.getElementById('formContentSettings');
  if (formContentSettings) {
    formContentSettings.onsubmit = async (e) => {
      e.preventDefault();
      const homepage_notice_text = (document.getElementById('settingHomepageNotice')?.value || '').trim();
      const footer_copyright_text = (document.getElementById('settingFooterCopyright')?.value || '').trim();
      const system_version_text = (document.getElementById('settingSystemVersion')?.value || '').trim();

      const btn = document.getElementById('btnSaveContentSettings');
      if (btn) btn.disabled = true;
      try {
        await window.CampaignDB.savePaymentSettings({
          homepage_notice_text,
          footer_copyright_text,
          system_version_text
        });
        showAdminToast('متن‌های صفحه اصلی و فوتر با موفقیت ذخیره شدند.', 'success');
      } catch (err) {
        showAdminToast('خطا در ذخیره متن‌ها: ' + err.message, 'error');
      } finally {
        if (btn) btn.disabled = false;
      }
    };
  }

  const btnTestDb = document.getElementById('btnTestDatabaseConnection') || document.getElementById('btnSaveSupabaseConfig');
  if (btnTestDb) {
    btnTestDb.onclick = async () => {
      const statusBox = document.getElementById('databaseConnectionStatus') || document.getElementById('supabaseConnectionStatus');
      if (statusBox) statusBox.innerHTML = '<span style="color: #64748b;">در حال تست اتصال پایگاه‌داده...</span>';
      const result = await window.CampaignDB.testDatabaseConnection();
      if (result.success) {
        if (statusBox) statusBox.innerHTML = `<span style="color: #15803d; font-weight: 700;">${result.message}</span>`;
        showAdminToast('اتصال با موفقیت تایید شد.', 'success');
        await reloadAdminData();
        renderCurrentSection();
      } else {
        if (statusBox) statusBox.innerHTML = `<span style="color: #b91c1c; font-weight: 700;">${result.message}</span>`;
        showAdminToast(result.message, 'error');
      }
    };
  }

  const btnCopySql = document.getElementById('btnCopySqlScript');
  if (btnCopySql) {
    btnCopySql.onclick = () => {
      const sql = typeof window.CampaignDB.getMySQLScript === 'function' ? window.CampaignDB.getMySQLScript() : '';
      navigator.clipboard.writeText(sql).then(() => {
        showAdminToast('کد اسکریپت SQL در کلیپ‌بورد کپی شد.', 'success');
      }).catch(() => {
        showAdminToast('خطا در کپی خودکار.', 'warning');
      });
    };
  }

  document.querySelectorAll('[data-close-admin-modal]').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.admin-modal-backdrop').forEach(m => m.classList.remove('open'));
      document.body.classList.remove('modal-open');
    };
  });

  document.querySelectorAll('.admin-modal-backdrop').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.remove('open');
        document.body.classList.remove('modal-open');
      }
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const openModal = document.querySelector('.admin-modal-backdrop.open');
      if (openModal) {
        openModal.classList.remove('open');
        document.body.classList.remove('modal-open');
      }
    }
  });

  try {
    const adminModalObserver = new MutationObserver(() => {
      const isAnyOpen = Boolean(document.querySelector('.admin-modal-backdrop.open'));
      if (isAnyOpen) {
        document.body.classList.add('modal-open');
      } else {
        document.body.classList.remove('modal-open');
      }
    });
    document.querySelectorAll('.admin-modal-backdrop').forEach(m => {
      adminModalObserver.observe(m, { attributes: true, attributeFilter: ['class'] });
    });
  } catch (e) {}

  // فیلترها و دکمه‌های بخش کاربران
  const uSearch = document.getElementById('usersFilterSearch');
  const uStatus = document.getElementById('usersFilterStatus');
  const uAnon = document.getElementById('usersFilterAnonymous');
  const uVis = document.getElementById('usersFilterVisibility');
  const uFrom = document.getElementById('usersFilterFromDate');
  const uTo = document.getElementById('usersFilterToDate');
  const btnResetU = document.getElementById('btnResetUsersFilters');
  const btnRefreshU = document.getElementById('btnRefreshUsers');
  const btnExportU = document.getElementById('btnExportUsersExcel');

  if (uSearch) {
    uSearch.oninput = () => {
      userFilters.search = uSearch.value.trim();
      userFilters.page = 1;
      renderUsersSection();
    };
  }
  if (uVis) {
    uVis.onchange = () => {
      userFilters.visibility = uVis.value;
      userFilters.page = 1;
      renderUsersSection();
    };
  }
  if (uAnon) {
    uAnon.onchange = () => {
      userFilters.anonymous = uAnon.value;
      userFilters.page = 1;
      renderUsersSection();
    };
  }
  if (uFrom) {
    uFrom.onchange = () => {
      userFilters.from_date = uFrom.value.trim();
      userFilters.page = 1;
      renderUsersSection();
    };
  }
  if (uTo) {
    uTo.onchange = () => {
      userFilters.to_date = uTo.value.trim();
      userFilters.page = 1;
      renderUsersSection();
    };
  }
  if (btnResetU) {
    btnResetU.onclick = () => {
      userFilters.search = '';
      userFilters.anonymous = 'all';
      userFilters.visibility = 'all';
      userFilters.from_date = '';
      userFilters.to_date = '';
      userFilters.page = 1;
      if (uSearch) uSearch.value = '';
      if (uAnon) uAnon.value = 'all';
      if (uVis) uVis.value = 'all';
      if (uFrom) uFrom.value = '';
      if (uTo) uTo.value = '';
      renderUsersSection();
    };
  }
  if (btnRefreshU) {
    btnRefreshU.onclick = () => {
      renderUsersSection();
      showAdminToast('لیست کاربران بروزرسانی شد.', 'info');
    };
  }
  if (btnExportU) {
    btnExportU.onclick = exportUsersToExcel;
  }

  // فیلترها و دکمه‌های بخش لاگ‌ها
  const lSearch = document.getElementById('logsFilterSearch');
  const lAction = document.getElementById('logsFilterActionType');
  const lActor = document.getElementById('logsFilterActor');
  const lFrom = document.getElementById('logsFilterFromDate');
  const lTo = document.getElementById('logsFilterToDate');
  const btnResetL = document.getElementById('btnResetLogsFilters');
  const btnRefreshL = document.getElementById('btnRefreshLogs');

  if (lSearch) {
    lSearch.oninput = () => {
      logFilters.search = lSearch.value.trim();
      logFilters.page = 1;
      renderLogsSection();
    };
  }
  if (lAction) {
    lAction.onchange = () => {
      logFilters.action_type = lAction.value;
      logFilters.page = 1;
      renderLogsSection();
    };
  }
  if (lActor) {
    lActor.onchange = () => {
      logFilters.actor = lActor.value;
      logFilters.page = 1;
      renderLogsSection();
    };
  }
  if (lFrom) {
    lFrom.onchange = () => {
      logFilters.from_date = lFrom.value.trim();
      logFilters.page = 1;
      renderLogsSection();
    };
  }
  if (lTo) {
    lTo.onchange = () => {
      logFilters.to_date = lTo.value.trim();
      logFilters.page = 1;
      renderLogsSection();
    };
  }
  if (btnResetL) {
    btnResetL.onclick = () => {
      logFilters.search = '';
      logFilters.action_type = 'all';
      logFilters.actor = 'all';
      logFilters.from_date = '';
      logFilters.to_date = '';
      logFilters.page = 1;
      if (lSearch) lSearch.value = '';
      if (lAction) lAction.value = 'all';
      if (lActor) lActor.value = 'all';
      if (lFrom) lFrom.value = '';
      if (lTo) lTo.value = '';
      renderLogsSection();
    };
  }
  if (btnRefreshL) {
    btnRefreshL.onclick = () => {
      renderLogsSection();
      showAdminToast('لیست لاگ‌ها بروزرسانی شد.', 'info');
    };
  }

  // راه‌اندازی رویدادهای مدیریت مدیران و پنل پیامک
  setupAdminsEvents();
  setupSmsEvents();

  // راه‌اندازی رویدادهای ویرایشگر قوانین
  setupTermsEditorEvents();
}

// -------------------------------------------------------------
// اعمال محدودیت‌های نمایشی بر اساس دسترسی مدیر (Permission Visibility)
// -------------------------------------------------------------
function applyPermissionVisibility() {
  const user = window.AdminAuth ? window.AdminAuth.getCurrentUser() : null;
  const isSuper = user && Boolean(user.is_super_admin);
  const perms = (user && user.permissions) || [];

  document.querySelectorAll('.sidebar-nav .nav-item-btn').forEach(btn => {
    const perm = btn.getAttribute('data-permission');
    if (!perm || isSuper || perms.includes(perm)) {
      btn.style.display = '';
    } else {
      btn.style.display = 'none';
      if (btn.classList.contains('active')) {
        btn.classList.remove('active');
        navigateToSection('dashboard');
      }
    }
  });

  document.querySelectorAll('[data-quick-action]').forEach(btn => {
    const action = btn.getAttribute('data-quick-action');
    if (action === 'add-campaign' || action === 'campaigns') {
      btn.style.display = (isSuper || perms.includes('campaigns')) ? '' : 'none';
    } else if (action === 'add-payment' || action === 'reports') {
      btn.style.display = (isSuper || perms.includes('payments')) ? '' : 'none';
    }
  });
}

// -------------------------------------------------------------
// بخش مدیریت مدیران و دسترسی‌ها (Admins Management)
// -------------------------------------------------------------
let adminsSearchQuery = '';
let adminsStatusFilter = 'all';
let adminsRoleFilter = 'all';

async function renderAdminsSection() {
  const tbody = document.getElementById('adminsTableBody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 28px; color: #64748b;"><div style="display: flex; align-items: center; justify-content: center; gap: 8px;"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="animate-spin" style="animation: spin 1s linear infinite;"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg><span>در حال دریافت اطلاعات مدیران سامانه...</span></div></td></tr>';

  try {
    allAdmins = await window.CampaignDB.getAdmins();

    const permLabels = {
      dashboard: 'داشبورد',
      campaigns: 'پویش‌ها',
      payments: 'تراکنش‌ها',
      users: 'کاربران',
      cooperation: 'همکاری',
      notifications: 'اعلان‌ها',
      logs: 'لاگ‌ها',
      settings: 'تنظیمات',
      terms: 'قوانین',
      tickets: 'تیکت‌ها',
      sms: 'پیامک',
      admins: 'مدیریت',
      trash: 'زباله‌دان'
    };

    let filtered = [...allAdmins];
    if (adminsSearchQuery) {
      const q = adminsSearchQuery.toLowerCase();
      filtered = filtered.filter(a => 
        (a.name || '').toLowerCase().includes(q) || 
        (a.email || '').toLowerCase().includes(q) ||
        (String(a.id || '')).toLowerCase().includes(q)
      );
    }
    if (adminsStatusFilter === 'active') {
      filtered = filtered.filter(a => a.is_active !== false);
    } else if (adminsStatusFilter === 'inactive') {
      filtered = filtered.filter(a => a.is_active === false);
    }
    if (adminsRoleFilter === 'super') {
      filtered = filtered.filter(a => Boolean(a.is_super_admin));
    } else if (adminsRoleFilter === 'custom') {
      filtered = filtered.filter(a => !a.is_super_admin);
    }

    updateAdminStatsMetrics(filtered.length);

    if (!allAdmins || allAdmins.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7">
            <div style="padding: 44px 20px; text-align: center;">
              <div style="width: 56px; height: 56px; border-radius: 16px; background: #f1f5f9; color: #64748b; display: flex; align-items: center; justify-content: center; margin: 0 auto 14px;">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                  <circle cx="9" cy="7" r="4"></circle>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                </svg>
              </div>
              <h4 style="font-size: 1rem; font-weight: 800; color: #1e293b; margin-bottom: 6px;">هیچ حساب مدیری در سامانه ثبت نشده است</h4>
              <p style="font-size: 0.82rem; color: #64748b; margin-bottom: 16px;">برای شروع می‌توانید اولین حساب مدیر را تعریف کنید.</p>
              <button type="button" class="btn-quick-action primary" onclick="window.openAddAdminModal()">افزودن مدیر جدید</button>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    if (filtered.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7">
            <div style="padding: 44px 20px; text-align: center;">
              <div style="width: 56px; height: 56px; border-radius: 16px; background: #f1f5f9; color: #64748b; display: flex; align-items: center; justify-content: center; margin: 0 auto 14px;">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
              </div>
              <h4 style="font-size: 1rem; font-weight: 800; color: #1e293b; margin-bottom: 6px;">هیچ مدیری با فیلترهای انتخابی یافت نشد</h4>
              <p style="font-size: 0.82rem; color: #64748b; margin-bottom: 16px;">عبارت جستجو یا فیلترهای وضعیت و نقش را تغییر داده و مجدداً تلاش نمایید.</p>
              <div style="display: flex; gap: 8px; justify-content: center; flex-wrap: wrap;">
                <button type="button" class="btn-quick-action" onclick="window.resetAdminsFilters()">پاکسازی فیلترها</button>
                <button type="button" class="btn-quick-action primary" onclick="window.openAddAdminModal()">افزودن مدیر جدید</button>
              </div>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = filtered.map(admin => {
      const isSuper = Boolean(admin.is_super_admin);
      const isActive = admin.is_active !== false;
      const statusBadge = isActive 
        ? '<span class="status-badge success" style="cursor: pointer; display: inline-flex; align-items: center; gap: 4px;" onclick="window.toggleAdminStatusAction(\'' + admin.id + '\', true)" title="کلیک جهت غیرفعال‌سازی"><span style="width: 6px; height: 6px; border-radius: 50%; background: #059669;"></span>فعال</span>' 
        : '<span class="status-badge failed" style="cursor: pointer; display: inline-flex; align-items: center; gap: 4px;" onclick="window.toggleAdminStatusAction(\'' + admin.id + '\', false)" title="کلیک جهت فعال‌سازی"><span style="width: 6px; height: 6px; border-radius: 50%; background: #dc2626;"></span>غیرفعال</span>';
      
      const roleBadge = isSuper
        ? '<span class="badge-role super"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg> مدیر ارشد</span>'
        : '<span class="badge-role custom"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> مدیر بخش</span>';

      const initialChar = (admin.name && admin.name.trim() ? admin.name.trim()[0] : 'م').toUpperCase();
      const avatarHtml = `<div class="admin-avatar-bubble ${isSuper ? 'super' : ''}" title="${escapeHtml(admin.name || admin.email)}">${isSuper ? '★' : initialChar}</div>`;

      let permsHtml = '';
      if (isSuper) {
        permsHtml = '<span style="font-size: 0.8rem; color: #b45309; font-weight: 800; display: inline-flex; align-items: center; gap: 5px; background: #fef3c7; padding: 3px 9px; border-radius: 6px; border: 1px solid #fde68a;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> دسترسی کامل به کل سامانه (۱۳ بخش)</span>';
      } else {
        const perms = admin.permissions || [];
        if (perms.length === 0) {
          permsHtml = '<span style="font-size: 0.78rem; color: #94a3b8; font-style: italic;">فاقد دسترسی به بخش‌ها</span>';
        } else {
          permsHtml = `<div style="display: flex; gap: 4px; flex-wrap: wrap;">` +
            perms.map(p => {
              const isTrash = p === 'trash';
              const isAdmins = p === 'admins';
              let style = 'background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0;';
              if (isTrash) style = 'background: #ffe4e6; color: #be123c; font-weight: 700; border: 1px solid #fecdd3;';
              else if (isAdmins) style = 'background: #eff6ff; color: #1d4ed8; font-weight: 700; border: 1px solid #bfdbfe;';
              return `<span style="font-size: 0.73rem; ${style} padding: 2px 7px; border-radius: 6px;">${permLabels[p] || p}</span>`;
            }).join('') +
            `</div>`;
        }
      }

      let dateStr = '---';
      if (admin.created_at) {
        try {
          const d = new Date(admin.created_at);
          dateStr = window.CampaignDB.toPersianDigits(d.toLocaleDateString('fa-IR'));
        } catch (e) {
          dateStr = admin.created_at;
        }
      }

      return `
        <tr>
          <td>
            <div style="display: flex; align-items: center; gap: 10px;">
              ${avatarHtml}
              <div>
                <strong style="color: #0f172a; font-size: 0.92rem; display: block;">${escapeHtml(admin.name || 'مدیر')}</strong>
                <span style="font-size: 0.74rem; color: #64748b;">${isSuper ? 'مدیر با اختیارات کامل (Super)' : 'مدیر اختصاصی بخش'}</span>
              </div>
            </div>
          </td>
          <td>
            <div style="display: flex; align-items: center; gap: 6px;">
              <span style="direction: ltr; text-align: right; font-family: monospace; font-size: 0.86rem; color: #334155; font-weight: 600;">${escapeHtml(admin.email || '')}</span>
            </div>
          </td>
          <td style="text-align: center;">${statusBadge}</td>
          <td style="text-align: center;">${roleBadge}</td>
          <td>${permsHtml}</td>
          <td style="font-size: 0.82rem; color: #64748b; text-align: center;">${dateStr}</td>
          <td style="text-align: center;">
            <div style="display: flex; gap: 6px; align-items: center; justify-content: center;">
              <button type="button" class="btn-action-icon" onclick="window.openEditAdminModal('${admin.id}')" title="ویرایش مشخصات و دسترسی‌ها">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button type="button" class="btn-action-icon" onclick="window.toggleAdminStatusAction('${admin.id}', ${isActive})" title="${isActive ? 'غیرفعال‌سازی حساب' : 'فعال‌سازی مجدد حساب'}" style="color: ${isActive ? '#e11d48' : '#059669'};">
                ${isActive 
                  ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>' 
                  : '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'}
              </button>
              <button type="button" class="btn-action-icon delete" onclick="window.deleteAdminAction('${admin.id}')" title="انتقال حساب مدیر به زباله‌دان">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('خطای دریافت مدیران:', err);
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 24px; color: #e11d48;">خطا در دریافت لیست مدیران: ${err.message}</td></tr>`;
    showAdminToast(err.message, 'error');
  }
}

function updateAdminStatsMetrics(filteredCount) {
  const totalEl = document.getElementById('statAdminsTotalCount');
  const activeEl = document.getElementById('statAdminsActiveCount');
  const inactiveEl = document.getElementById('statAdminsInactiveCount');
  const superEl = document.getElementById('statAdminsSuperCount');

  const total = (allAdmins || []).length;
  const active = (allAdmins || []).filter(a => a.is_active !== false).length;
  const inactive = (allAdmins || []).filter(a => a.is_active === false).length;
  const superCount = (allAdmins || []).filter(a => a.is_super_admin).length;

  if (totalEl) totalEl.textContent = window.CampaignDB.toPersianDigits(total);
  if (activeEl) activeEl.textContent = window.CampaignDB.toPersianDigits(active);
  if (inactiveEl) inactiveEl.textContent = window.CampaignDB.toPersianDigits(inactive);
  if (superEl) superEl.textContent = window.CampaignDB.toPersianDigits(superCount);

  // بروزرسانی بج‌های شمارنده در هدر و پاورقی جدول
  const countBadge = document.getElementById('adminsTableBadge');
  if (countBadge) {
    countBadge.textContent = window.CampaignDB.toPersianDigits(total) + ' مدیر';
  }

  const paginationInfo = document.getElementById('adminsPaginationInfo');
  if (paginationInfo) {
    const fCount = filteredCount !== undefined ? filteredCount : total;
    if (fCount === total) {
      paginationInfo.textContent = `نمایش ${window.CampaignDB.toPersianDigits(total)} مدیر ثبت‌شده`;
    } else {
      paginationInfo.textContent = `نمایش ${window.CampaignDB.toPersianDigits(fCount)} مدیر از مجموع ${window.CampaignDB.toPersianDigits(total)} مدیر`;
    }
  }

  const filterCounter = document.getElementById('adminsFilterCounter');
  if (filterCounter) {
    const hasFilter = adminsSearchQuery || adminsStatusFilter !== 'all' || adminsRoleFilter !== 'all';
    if (hasFilter) {
      filterCounter.textContent = `فیلترشده: ${window.CampaignDB.toPersianDigits(filteredCount || 0)} مدیر`;
    } else {
      filterCounter.textContent = `همه مدیران (${window.CampaignDB.toPersianDigits(total)})`;
    }
  }

  // بروزرسانی وضعیت فعال بودن کارت‌های شاخص
  document.querySelectorAll('.admins-stat-card').forEach(card => card.classList.remove('active-stat-card'));
  if (adminsRoleFilter === 'super') {
    document.querySelector('.admins-stat-card[data-admin-card="super"]')?.classList.add('active-stat-card');
  } else if (adminsStatusFilter === 'active') {
    document.querySelector('.admins-stat-card[data-admin-card="active"]')?.classList.add('active-stat-card');
  } else if (adminsStatusFilter === 'inactive') {
    document.querySelector('.admins-stat-card[data-admin-card="inactive"]')?.classList.add('active-stat-card');
  } else {
    document.querySelector('.admins-stat-card[data-admin-card="all"]')?.classList.add('active-stat-card');
  }
}

window.quickFilterAdminRole = function(role) {
  adminsRoleFilter = role || 'all';
  const roleSelect = document.getElementById('adminsRoleFilter');
  if (roleSelect) roleSelect.value = adminsRoleFilter;
  if (role === 'all') {
    adminsStatusFilter = 'all';
    const statusSelect = document.getElementById('adminsStatusFilter');
    if (statusSelect) statusSelect.value = 'all';
  }
  renderAdminsSection();
};

window.quickFilterAdminStatus = function(status) {
  adminsStatusFilter = status || 'all';
  const statusSelect = document.getElementById('adminsStatusFilter');
  if (statusSelect) statusSelect.value = adminsStatusFilter;
  adminsRoleFilter = 'all';
  const roleSelect = document.getElementById('adminsRoleFilter');
  if (roleSelect) roleSelect.value = 'all';
  renderAdminsSection();
};

window.resetAdminsFilters = function() {
  adminsSearchQuery = '';
  adminsStatusFilter = 'all';
  adminsRoleFilter = 'all';
  const sInput = document.getElementById('adminsSearchInput');
  if (sInput) sInput.value = '';
  const sStatus = document.getElementById('adminsStatusFilter');
  if (sStatus) sStatus.value = 'all';
  const sRole = document.getElementById('adminsRoleFilter');
  if (sRole) sRole.value = 'all';
  renderAdminsSection();
};

window.toggleAllAdminPerms = function(targetModal, selectAll) {
  const selector = targetModal === 'add' ? '.add-perm-cb' : '.edit-perm-cb';
  document.querySelectorAll(selector).forEach(cb => {
    if (!cb.disabled) {
      cb.checked = selectAll;
    }
  });
};

window.openAddAdminModal = function() {
  const modal = document.getElementById('modalAddAdmin');
  const form = document.getElementById('formAddAdmin');
  if (form) form.reset();
  const superCb = document.getElementById('addAdminIsSuper');
  if (superCb) superCb.checked = false;
  document.querySelectorAll('.add-perm-cb').forEach(cb => {
    cb.checked = cb.value !== 'admins';
    cb.disabled = false;
  });
  if (modal) modal.classList.add('open');
};

window.openEditAdminModal = function(adminId) {
  const admin = allAdmins.find(a => String(a.id) === String(adminId));
  if (!admin) return;

  document.getElementById('editAdminId').value = admin.id;
  document.getElementById('editAdminName').value = admin.name || '';
  document.getElementById('editAdminEmail').value = admin.email || '';
  document.getElementById('editAdminPassword').value = '';
  document.getElementById('editAdminIsActive').checked = admin.is_active !== false;
  
  const superCb = document.getElementById('editAdminIsSuper');
  superCb.checked = Boolean(admin.is_super_admin);

  const adminPerms = admin.permissions || [];
  document.querySelectorAll('.edit-perm-cb').forEach(cb => {
    cb.checked = admin.is_super_admin || adminPerms.includes(cb.value);
    cb.disabled = Boolean(admin.is_super_admin);
  });

  const modal = document.getElementById('modalEditAdmin');
  if (modal) modal.classList.add('open');
};

window.toggleAdminStatusAction = async function(adminId, currentActive) {
  const admin = allAdmins.find(a => String(a.id) === String(adminId));
  if (!admin) return;

  const actionText = currentActive ? 'غیرفعال' : 'فعال';
  const ok = await showAdminConfirm({
    title: `${actionText} کردن حساب مدیر`,
    message: `آیا از ${actionText} کردن حساب مدیر «${admin.name || admin.email}» اطمینان دارید؟`,
    subtext: currentActive ? 'با غیرفعال‌سازی، امکان ورود این مدیر به سامانه مسدود خواهد شد.' : 'با فعال‌سازی، دسترسی مجدد این مدیر به سامانه برقرار خواهد شد.',
    confirmText: `بله، ${actionText} شود`,
    danger: Boolean(currentActive)
  });
  if (!ok) return;

  try {
    await window.CampaignDB.updateAdmin(adminId, { is_active: !currentActive });
    showAdminToast(`حساب مدیر با موفقیت ${actionText} شد.`, 'success');
    await renderAdminsSection();
  } catch (err) {
    showAdminToast(`خطا: ${err.message}`, 'error');
  }
};

window.deleteAdminAction = async function(adminId) {
  const admin = allAdmins.find(a => String(a.id) === String(adminId));
  if (!admin) return;

  const ok = await showAdminConfirm({
    title: 'تایید انتقال مدیر به زباله‌دان',
    message: `آیا از انتقال حساب مدیر «${admin.name || admin.email}» به زباله‌دان اطمینان دارید؟`,
    subtext: 'اطلاعات مدیر در زباله‌دان محفوظ خواهد ماند و در صورت لزوم قابل بازیابی است.',
    confirmText: 'بله، حذف مدیر',
    danger: true
  });
  if (!ok) return;

  try {
    await window.CampaignDB.deleteAdmin(adminId);
    showAdminToast('حساب مدیر با موفقیت به زباله‌دان منتقل شد.', 'success');
    await renderAdminsSection();
    await loadTrashData();
    renderTrashSection();
  } catch (err) {
    showAdminToast(`خطا: ${err.message}`, 'error');
  }
};

function setupAdminsEvents() {
  const btnOpenAdd = document.getElementById('btnOpenAddAdminModal');
  if (btnOpenAdd) {
    btnOpenAdd.onclick = () => window.openAddAdminModal();
  }

  const btnRefresh = document.getElementById('btnRefreshAdmins');
  if (btnRefresh) {
    btnRefresh.onclick = () => {
      renderAdminsSection();
      showAdminToast('فهرست مدیران بروزرسانی شد.', 'info');
    };
  }

  const searchInput = document.getElementById('adminsSearchInput');
  if (searchInput && !searchInput._bound) {
    searchInput._bound = true;
    let timer = null;
    searchInput.oninput = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        adminsSearchQuery = searchInput.value.trim();
        renderAdminsSection();
      }, 250);
    };
  }

  const statusFilter = document.getElementById('adminsStatusFilter');
  if (statusFilter && !statusFilter._bound) {
    statusFilter._bound = true;
    statusFilter.onchange = () => {
      adminsStatusFilter = statusFilter.value;
      renderAdminsSection();
    };
  }

  const roleFilter = document.getElementById('adminsRoleFilter');
  if (roleFilter && !roleFilter._bound) {
    roleFilter._bound = true;
    roleFilter.onchange = () => {
      adminsRoleFilter = roleFilter.value;
      renderAdminsSection();
    };
  }

  const addSuperCb = document.getElementById('addAdminIsSuper');
  if (addSuperCb) {
    addSuperCb.onchange = () => {
      const isChecked = addSuperCb.checked;
      document.querySelectorAll('.add-perm-cb').forEach(cb => {
        cb.checked = isChecked;
        cb.disabled = isChecked;
      });
    };
  }

  const editSuperCb = document.getElementById('editAdminIsSuper');
  if (editSuperCb) {
    editSuperCb.onchange = () => {
      const isChecked = editSuperCb.checked;
      document.querySelectorAll('.edit-perm-cb').forEach(cb => {
        cb.checked = isChecked;
        cb.disabled = isChecked;
      });
    };
  }

  const formAddAdmin = document.getElementById('formAddAdmin');
  if (formAddAdmin) {
    formAddAdmin.onsubmit = async (e) => {
      e.preventDefault();
      const submitBtn = document.getElementById('btnSubmitAddAdmin');
      if (submitBtn) submitBtn.disabled = true;

      try {
        const name = document.getElementById('addAdminName').value.trim();
        const email = document.getElementById('addAdminEmail').value.trim();
        const password = document.getElementById('addAdminPassword').value.trim();
        const is_super_admin = document.getElementById('addAdminIsSuper').checked;

        let permissions = [];
        if (is_super_admin) {
          permissions = ['dashboard', 'campaigns', 'payments', 'users', 'cooperation', 'notifications', 'logs', 'settings', 'terms', 'tickets', 'sms', 'admins', 'trash'];
        } else {
          document.querySelectorAll('.add-perm-cb:checked').forEach(cb => {
            permissions.push(cb.value);
          });
        }

        await window.CampaignDB.createAdmin({
          name,
          email,
          password,
          is_super_admin,
          permissions
        });

        showAdminToast('مدیر جدید با موفقیت ایجاد شد.', 'success');
        document.getElementById('modalAddAdmin')?.classList.remove('open');
        await renderAdminsSection();
      } catch (err) {
        showAdminToast(`خطا در ایجاد مدیر: ${err.message}`, 'error');
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    };
  }

  const formEditAdmin = document.getElementById('formEditAdmin');
  if (formEditAdmin) {
    formEditAdmin.onsubmit = async (e) => {
      e.preventDefault();
      const submitBtn = document.getElementById('btnSubmitEditAdmin');
      if (submitBtn) submitBtn.disabled = true;

      try {
        const id = document.getElementById('editAdminId').value;
        const name = document.getElementById('editAdminName').value.trim();
        const email = document.getElementById('editAdminEmail').value.trim();
        const password = document.getElementById('editAdminPassword').value.trim();
        const is_active = document.getElementById('editAdminIsActive').checked;
        const is_super_admin = document.getElementById('editAdminIsSuper').checked;

        let permissions = [];
        if (is_super_admin) {
          permissions = ['dashboard', 'campaigns', 'payments', 'users', 'cooperation', 'notifications', 'logs', 'settings', 'terms', 'tickets', 'sms', 'admins', 'trash'];
        } else {
          document.querySelectorAll('.edit-perm-cb:checked').forEach(cb => {
            permissions.push(cb.value);
          });
        }

        const updateData = {
          name,
          email,
          is_active,
          is_super_admin,
          permissions
        };
        if (password && password.length >= 6) {
          updateData.password = password;
        }

        await window.CampaignDB.updateAdmin(id, updateData);
        showAdminToast('مشخصات مدیر با موفقیت بروزرسانی شد.', 'success');
        document.getElementById('modalEditAdmin')?.classList.remove('open');
        await renderAdminsSection();
      } catch (err) {
        showAdminToast(`خطا در ویرایش مدیر: ${err.message}`, 'error');
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    };
  }
}

// -------------------------------------------------------------
// بخش پنل و تنظیمات پیامک (SMS Panel)
// -------------------------------------------------------------
let activeSmsSubTab = 'config';
let smsLogSearchQuery = '';
let smsLogStatusFilter = 'all';

function switchSmsSubTab(subtab) {
  activeSmsSubTab = subtab || 'config';
  const tabBtns = document.querySelectorAll('#smsSectionTabs .sms-tab-btn');
  tabBtns.forEach(btn => {
    const t = btn.getAttribute('data-sms-subtab');
    btn.classList.toggle('active', t === activeSmsSubTab);
  });

  const cConfig = document.getElementById('smsSubtabConfig');
  const cTemplates = document.getElementById('smsSubtabTemplates');
  const cLogs = document.getElementById('smsSubtabLogs');

  if (cConfig) cConfig.style.display = activeSmsSubTab === 'config' ? 'block' : 'none';
  if (cTemplates) cTemplates.style.display = activeSmsSubTab === 'templates' ? 'block' : 'none';
  if (cLogs) cLogs.style.display = activeSmsSubTab === 'logs' ? 'block' : 'none';

  if (activeSmsSubTab === 'templates') {
    const val = document.getElementById('settingSmsThankYouTemplate')?.value || '';
    updateSmsLivePreview(val);
    updateSmsCharCounter(val);
  }
}
window.switchSmsSubTab = switchSmsSubTab;

async function renderSmsSection() {
  try {
    const [settingsRes, logsRes] = await Promise.all([
      window.CampaignDB.getSmsSettings().catch(() => null),
      window.CampaignDB.getSmsLogs().catch(() => [])
    ]);

    if (settingsRes) {
      currentSmsSettings = settingsRes;
      populateSmsSettingsForm(settingsRes);
    }
    allSmsLogs = logsRes || [];
    updateSmsKpiMetrics();
    renderSmsLogsTable(allSmsLogs);
  } catch (err) {
    console.error('خطای بارگذاری پنل پیامک:', err);
    showAdminToast(`خطا در بارگذاری پنل پیامک: ${err.message}`, 'error');
  }
}

function updateSmsKpiMetrics() {
  const total = allSmsLogs.length;
  const sentCount = allSmsLogs.filter(l => l.status === 'sent').length;
  const failedCount = allSmsLogs.filter(l => l.status !== 'sent').length;
  const rate = total > 0 ? ((sentCount / total) * 100).toFixed(1) : '۱۰۰';

  const tEl = document.getElementById('statSmsTotalCount');
  const sEl = document.getElementById('statSmsSuccessCount');
  const fEl = document.getElementById('statSmsFailedCount');
  const rEl = document.getElementById('statSmsDeliveryRate');

  if (tEl) tEl.textContent = window.CampaignDB.formatNumber(total);
  if (sEl) sEl.textContent = window.CampaignDB.formatNumber(sentCount);
  if (fEl) fEl.textContent = window.CampaignDB.formatNumber(failedCount);
  if (rEl) rEl.textContent = window.CampaignDB.toPersianDigits(rate) + '٪';
}

function updateSmsCharCounter(text) {
  const counterEl = document.getElementById('smsCharCountText');
  if (!counterEl) return;
  const len = (text || '').length;
  let pages = 1;
  if (len > 70) {
    pages = 1 + Math.ceil((len - 70) / 64);
  }
  counterEl.textContent = `${window.CampaignDB.formatNumber(len)} کاراکتر (${window.CampaignDB.formatNumber(pages)} پیامک فارسی)`;
}

function populateSmsSettingsForm(s) {
  const enabledSelect = document.getElementById('settingSmsEnabled');
  const providerSelect = document.getElementById('settingSmsProvider');
  const apiKeyInput = document.getElementById('settingSmsApiKey');
  const senderNumberInput = document.getElementById('settingSmsSenderNumber');
  const templateTextarea = document.getElementById('settingSmsThankYouTemplate');

  if (enabledSelect) enabledSelect.value = s.is_enabled ? 'true' : 'false';
  if (providerSelect) providerSelect.value = s.active_provider || 'simulator';
  if (apiKeyInput) {
    apiKeyInput.value = s.api_key || '';
    apiKeyInput.placeholder = s.has_api_key ? '•••••••• (تنظیم شده)' : 'کلید وب‌سرویس پیامک';
  }
  if (senderNumberInput) senderNumberInput.value = s.sender_number || '';
  if (templateTextarea) templateTextarea.value = s.thank_you_template || '';

  const mockupLine = document.getElementById('mockupSenderLine');
  if (mockupLine) mockupLine.textContent = s.sender_number || '300077';

  updateSmsStatusBadge(s.is_enabled);
  updateSmsLivePreview(s.thank_you_template || '');
  updateSmsCharCounter(s.thank_you_template || '');
}

function updateSmsStatusBadge(isEnabled) {
  const badge = document.getElementById('smsActiveStatusBadge');
  const text = document.getElementById('smsActiveStatusText');
  if (!badge || !text) return;

  if (isEnabled) {
    badge.style.background = '#ecfdf5';
    badge.style.color = '#047857';
    const dot = badge.querySelector('span');
    if (dot) dot.style.background = '#10b981';
    text.textContent = 'پیامک فعال است';
  } else {
    badge.style.background = '#fef2f2';
    badge.style.color = '#b91c1c';
    const dot = badge.querySelector('span');
    if (dot) dot.style.background = '#ef4444';
    text.textContent = 'پیامک غیرفعال است';
  }
}

function updateSmsLivePreview(templateText) {
  const previewBox = document.getElementById('smsLivePreview');
  if (!previewBox) return;

  const now = new Date();
  const dateStr = window.CampaignDB.toPersianDigits(now.toLocaleDateString('fa-IR'));
  const timeStr = window.CampaignDB.toPersianDigits(now.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }));

  let sample = templateText || '';
  sample = sample.replace(/\{campaign_name\}/g, 'پویش بزرگ اطعام عید غدیر');
  sample = sample.replace(/\{amount\}/g, '۲۰۰,۰۰۰ تومان');
  sample = sample.replace(/\{tracking_id\}/g, 'POY-782194');
  sample = sample.replace(/\{user_name\}/g, 'محمد صادقی');
  sample = sample.replace(/\{date\}/g, dateStr);
  sample = sample.replace(/\{time\}/g, timeStr);

  previewBox.textContent = sample || '(متن پیامک خالی است)';

  const timeTag = document.getElementById('mockupTimeTag');
  if (timeTag) timeTag.textContent = timeStr;
}

function renderSmsLogsTable(logs) {
  const tbody = document.getElementById('smsLogsTableBody');
  if (!tbody) return;

  let list = Array.isArray(logs) ? [...logs] : [];
  if (smsLogSearchQuery) {
    const q = smsLogSearchQuery.toLowerCase();
    list = list.filter(l => 
      (l.phone || '').toLowerCase().includes(q) ||
      (l.message || '').toLowerCase().includes(q) ||
      (l.tracking_code || '').toLowerCase().includes(q)
    );
  }
  if (smsLogStatusFilter === 'sent') {
    list = list.filter(l => l.status === 'sent');
  } else if (smsLogStatusFilter === 'failed') {
    list = list.filter(l => l.status !== 'sent');
  }

  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 24px; color: #64748b;">هیچ پیامکی با این مشخصات یافت نشد.</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(log => {
    const isSent = log.status === 'sent';
    const statusBadge = isSent
      ? '<span class="status-badge success">ارسال شد</span>'
      : '<span class="status-badge failed">ناموفق</span>';

    const providerNames = {
      simulator: 'شبیه‌ساز',
      sms_ir: 'sms.ir',
      kavenegar: 'کاوه‌نگار'
    };
    const providerBadge = `<span style="font-size: 0.78rem; background: #f1f5f9; color: #475569; padding: 2px 8px; border-radius: 6px;">${providerNames[log.provider] || log.provider || 'نامشخص'}</span>`;

    let dateStr = '---';
    if (log.created_at) {
      try {
        const d = new Date(log.created_at);
        dateStr = window.CampaignDB.toPersianDigits(d.toLocaleDateString('fa-IR')) + ' ' + window.CampaignDB.toPersianDigits(d.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }));
      } catch (e) {
        dateStr = log.created_at;
      }
    }

    const retryBtn = !isSent 
      ? `<button type="button" class="btn-quick-action" onclick="window.retrySmsAction('${log.id}', '${log.payment_id || ''}')" style="padding: 4px 10px; font-size: 0.78rem; background: #fef2f2; color: #b91c1c; border-color: #fecdd3; font-weight: 700;" title="تلاش مجدد ارسال">تلاش مجدد</button>`
      : `<span style="color: #059669; font-size: 0.85rem; font-weight: 800;">✓ تحویل شد</span>`;

    return `
      <tr>
        <td style="direction: ltr; text-align: right; font-weight: 700; color: #0f172a;">${window.CampaignDB.toPersianDigits(log.phone || '')}</td>
        <td style="font-size: 0.85rem; max-width: 320px; white-space: pre-wrap; line-height: 1.6; color: #334155;">${escapeHtml(log.message || '')}</td>
        <td>${providerBadge}</td>
        <td style="font-weight: 700; color: #047857; font-size: 0.85rem; font-family: monospace;">${escapeHtml(log.tracking_code || '---')}</td>
        <td>${statusBadge}</td>
        <td style="font-size: 0.78rem; color: #64748b;">${dateStr}</td>
        <td style="text-align: center;">${retryBtn}</td>
      </tr>
    `;
  }).join('');
}

window.retrySmsAction = async function(logId, paymentId) {
  try {
    showAdminToast('در حال تلاش مجدد برای ارسال پیامک...', 'info');
    await window.CampaignDB.retrySms(logId, paymentId);
    showAdminToast('پیامک با موفقیت مجدداً ارسال گردید.', 'success');
    allSmsLogs = await window.CampaignDB.getSmsLogs();
    updateSmsKpiMetrics();
    renderSmsLogsTable(allSmsLogs);
  } catch (err) {
    showAdminToast(`خطا در ارسال مجدد: ${err.message}`, 'error');
  }
};

function setupSmsEvents() {
  document.querySelectorAll('.sms-variable-badge[data-sms-tag]').forEach(badge => {
    badge.onclick = () => {
      const tag = badge.getAttribute('data-sms-tag');
      const textarea = document.getElementById('settingSmsThankYouTemplate');
      if (!textarea || !tag) return;
      const start = textarea.selectionStart || textarea.value.length;
      const end = textarea.selectionEnd || textarea.value.length;
      const val = textarea.value;
      textarea.value = val.substring(0, start) + tag + val.substring(end);
      textarea.selectionStart = textarea.selectionEnd = start + tag.length;
      textarea.focus();
      updateSmsLivePreview(textarea.value);
      updateSmsCharCounter(textarea.value);
    };
  });

  const templateTextarea = document.getElementById('settingSmsThankYouTemplate');
  if (templateTextarea) {
    templateTextarea.oninput = () => {
      updateSmsLivePreview(templateTextarea.value);
      updateSmsCharCounter(templateTextarea.value);
    };
  }

  // دکمه بازنشانی الگو به حالت پیش‌فرض
  const btnResetTpl = document.getElementById('btnResetSmsTemplate');
  if (btnResetTpl) {
    btnResetTpl.onclick = () => {
      const defaultTpl = 'مشارکت‌کننده گرامی {user_name}، نذر و همراهی شما در «{campaign_name}» به مبلغ {amount} با موفقیت ثبت شد.\nکد رهگیری: {tracking_id}\nتاریخ: {date} ساعت {time}\nاجرتان با صاحب پویش.';
      if (templateTextarea) {
        templateTextarea.value = defaultTpl;
        updateSmsLivePreview(defaultTpl);
        updateSmsCharCounter(defaultTpl);
        showAdminToast('الگوی متن پیامک به حالت پیش‌فرض بازنشانی شد.', 'info');
      }
    };
  }

  // دکمه ذخیره تنها الگو
  const btnSaveTplOnly = document.getElementById('btnSaveTemplateOnly');
  if (btnSaveTplOnly) {
    btnSaveTplOnly.onclick = async () => {
      btnSaveTplOnly.disabled = true;
      try {
        const thank_you_template = templateTextarea ? templateTextarea.value.trim() : '';
        await window.CampaignDB.saveSmsSettings({ thank_you_template });
        showAdminToast('الگوی متن پیامک با موفقیت ذخیره گردید.', 'success');
      } catch (err) {
        showAdminToast(`خطا در ذخیره الگو: ${err.message}`, 'error');
      } finally {
        btnSaveTplOnly.disabled = false;
      }
    };
  }

  // دکمه نمایش/مخفی‌سازی رمز API Key
  const btnToggleKey = document.getElementById('btnToggleSmsApiKey');
  if (btnToggleKey) {
    btnToggleKey.onclick = () => {
      const inp = document.getElementById('settingSmsApiKey');
      if (inp) {
        inp.type = inp.type === 'password' ? 'text' : 'password';
      }
    };
  }

  // فیلتر و جستجوی لاگ‌های پیامک
  const smsSearchInp = document.getElementById('smsLogSearchInput');
  if (smsSearchInp && !smsSearchInp._bound) {
    smsSearchInp._bound = true;
    let timer = null;
    smsSearchInp.oninput = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        smsLogSearchQuery = smsSearchInp.value.trim();
        renderSmsLogsTable(allSmsLogs);
      }, 250);
    };
  }

  const smsStatusFltr = document.getElementById('smsLogStatusFilter');
  if (smsStatusFltr && !smsStatusFltr._bound) {
    smsStatusFltr._bound = true;
    smsStatusFltr.onchange = () => {
      smsLogStatusFilter = smsStatusFltr.value;
      renderSmsLogsTable(allSmsLogs);
    };
  }

  const formSms = document.getElementById('formSmsSettings');
  if (formSms) {
    formSms.onsubmit = async (e) => {
      e.preventDefault();
      const btn = document.getElementById('btnSaveSmsSettings');
      if (btn) btn.disabled = true;

      try {
        const is_enabled = document.getElementById('settingSmsEnabled').value === 'true';
        const active_provider = document.getElementById('settingSmsProvider').value;
        const api_key = document.getElementById('settingSmsApiKey').value.trim();
        const sender_number = document.getElementById('settingSmsSenderNumber').value.trim();
        const thank_you_template = document.getElementById('settingSmsThankYouTemplate').value.trim();

        const payload = {
          is_enabled,
          active_provider,
          sender_number,
          thank_you_template
        };
        if (api_key && !api_key.includes('••••')) {
          payload.api_key = api_key;
        }

        await window.CampaignDB.saveSmsSettings(payload);
        showAdminToast('تنظیمات پیامک با موفقیت ذخیره شد.', 'success');
        updateSmsStatusBadge(is_enabled);
      } catch (err) {
        showAdminToast(`خطا در ذخیره تنظیمات: ${err.message}`, 'error');
      } finally {
        if (btn) btn.disabled = false;
      }
    };
  }

  const btnTestConn = document.getElementById('btnTestSmsConn');
  if (btnTestConn) {
    btnTestConn.onclick = async () => {
      btnTestConn.disabled = true;
      try {
        const res = await window.CampaignDB.testSmsConnection();
        showAdminToast(res.message || 'ارتباط با درگاه پیامک برقرار است.', 'success');
      } catch (err) {
        showAdminToast(`خطا در اتصال: ${err.message}`, 'error');
      } finally {
        btnTestConn.disabled = false;
      }
    };
  }

  const btnOpenTestModal = document.getElementById('btnOpenTestSmsModal');
  if (btnOpenTestModal) {
    btnOpenTestModal.onclick = () => {
      const modal = document.getElementById('modalTestSms');
      if (modal) modal.classList.add('open');
    };
  }

  const formTestSms = document.getElementById('formTestSms');
  if (formTestSms) {
    formTestSms.onsubmit = async (e) => {
      e.preventDefault();
      const rawPhone = document.getElementById('testSmsPhone').value.trim();
      const cleanPhone = window.CampaignDB.toEnglishDigits(rawPhone).replace(/\D/g, '');
      if (!cleanPhone) {
        showAdminToast('شماره تلفن همراه گیرنده الزامی است.', 'error');
        document.getElementById('testSmsPhone')?.focus();
        return;
      }
      if (!cleanPhone.startsWith('09')) {
        showAdminToast('فرمت شماره تماس اشتباه است. شماره همراه باید با ۰۹ شروع شود.', 'error');
        document.getElementById('testSmsPhone')?.focus();
        return;
      }
      if (cleanPhone.length !== 11) {
        showAdminToast('فرمت شماره تماس اشتباه است. شماره همراه باید دقیقاً ۱۱ رقم باشد.', 'error');
        document.getElementById('testSmsPhone')?.focus();
        return;
      }
      const phone = cleanPhone;
      const message = document.getElementById('testSmsMessage').value.trim();
      const submitBtn = document.getElementById('btnSubmitTestSms');
      if (submitBtn) submitBtn.disabled = true;

      try {
        const res = await window.CampaignDB.sendTestSms(phone, message);
        showAdminToast(res.message || 'پیامک آزمایشی با موفقیت ارسال شد.', 'success');
        document.getElementById('modalTestSms')?.classList.remove('open');
        allSmsLogs = await window.CampaignDB.getSmsLogs();
        updateSmsKpiMetrics();
        renderSmsLogsTable(allSmsLogs);
      } catch (err) {
        showAdminToast(`خطا در ارسال پیامک آزمایشی: ${err.message}`, 'error');
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    };
  }

  const btnRefreshLogs = document.getElementById('btnRefreshSmsLogs');
  if (btnRefreshLogs) {
    btnRefreshLogs.onclick = async () => {
      try {
        allSmsLogs = await window.CampaignDB.getSmsLogs();
        updateSmsKpiMetrics();
        renderSmsLogsTable(allSmsLogs);
        showAdminToast('لاگ‌های پیامک بروزرسانی شدند.', 'info');
      } catch (err) {
        showAdminToast(`خطا: ${err.message}`, 'error');
      }
    };
  }
}

// =============================================================
// بخش مدیریت درخواست‌ها (Requests Management)
// =============================================================
let allCooperations = [];
let currentCooperationTab = 'open'; // 'open' (درحال انتظار) | 'answered' (پاسخ داده شده) | 'all'
let cooperationFilters = {
  search: '',
  date: '',
  dateQuick: 'all',
  status: 'all'
};
let currentViewingCooperationId = null;

async function loadCooperationData() {
  try {
    if (window.CampaignDB && typeof window.CampaignDB.getCooperations === 'function') {
      const data = await window.CampaignDB.getCooperations();
      if (Array.isArray(data)) {
        allCooperations = data;
        updateCooperationBadges();
        return;
      }
    }
  } catch (err) {
    console.warn('خطا در دریافت درخواست‌های همکاری از سرور:', err);
  }
  allCooperations = [];
  updateCooperationBadges();
}

function updateCooperationBadges() {
  const openCount = allCooperations.filter(c => c.status === 'open' || !c.status).length;
  const answeredCount = allCooperations.filter(c => c.status === 'answered' || c.status === 'closed').length;
  const totalCount = allCooperations.length;

  const sidebarBadge = document.getElementById('sidebarCooperationBadge');
  if (sidebarBadge) {
    if (openCount > 0) {
      sidebarBadge.textContent = window.CampaignDB ? window.CampaignDB.toPersianDigits(openCount) : openCount;
      sidebarBadge.style.display = 'inline-block';
    } else {
      sidebarBadge.style.display = 'none';
    }
  }

  const elTotal = document.getElementById('cooperationStatTotal');
  const elOpen = document.getElementById('cooperationStatOpen');
  const elAnswered = document.getElementById('cooperationStatAnswered');

  if (elTotal) elTotal.textContent = window.CampaignDB ? window.CampaignDB.toPersianDigits(totalCount) : totalCount;
  if (elOpen) elOpen.textContent = window.CampaignDB ? window.CampaignDB.toPersianDigits(openCount) : openCount;
  if (elAnswered) elAnswered.textContent = window.CampaignDB ? window.CampaignDB.toPersianDigits(answeredCount) : answeredCount;

  const badgeTabOpen = document.getElementById('badgeCooperationTabOpen');
  const badgeTabAnswered = document.getElementById('badgeCooperationTabAnswered');
  if (badgeTabOpen) badgeTabOpen.textContent = window.CampaignDB ? window.CampaignDB.toPersianDigits(openCount) : openCount;
  if (badgeTabAnswered) badgeTabAnswered.textContent = window.CampaignDB ? window.CampaignDB.toPersianDigits(answeredCount) : answeredCount;
}

function switchCooperationTab(tabName) {
  currentCooperationTab = tabName || 'open';
  document.querySelectorAll('#cooperationSectionTabs .tickets-tab-btn').forEach(btn => {
    if (btn.getAttribute('data-cooperation-tab') === currentCooperationTab) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  const statusSelect = document.getElementById('cooperationFilterStatus');
  if (statusSelect) {
    if (tabName === 'open' || tabName === 'answered') {
      statusSelect.value = tabName;
      cooperationFilters.status = tabName;
    } else {
      statusSelect.value = 'all';
      cooperationFilters.status = 'all';
    }
  }

  renderCooperationTable();
}
window.switchCooperationTab = switchCooperationTab;

function getFilteredCooperations() {
  const filtered = allCooperations.filter(item => {
    const st = item.status || 'open';

    if (currentCooperationTab && currentCooperationTab !== 'all') {
      if (currentCooperationTab === 'open' && st !== 'open') return false;
      if (currentCooperationTab === 'answered' && st !== 'answered' && st !== 'closed') return false;
    }

    if (cooperationFilters.status && cooperationFilters.status !== 'all') {
      if (cooperationFilters.status === 'open' && st !== 'open') return false;
      if (cooperationFilters.status === 'answered' && st !== 'answered' && st !== 'closed') return false;
    }

    if (cooperationFilters.search) {
      const q = cooperationFilters.search.toLowerCase().trim();
      const qEn = window.CampaignDB ? window.CampaignDB.toEnglishDigits(q) : q;
      const qDigits = qEn.replace(/\D/g, '');

      const campaignName = (item.campaign_name || '').toLowerCase();
      const campaignTitle = (item.campaign_title || '').toLowerCase();
      const organizerName = (item.organizer_name || '').toLowerCase();
      const phone = (item.organizer_phone || '').toLowerCase();
      const phoneEn = window.CampaignDB ? window.CampaignDB.toEnglishDigits(phone) : phone;
      const phoneDigits = phoneEn.replace(/\D/g, '');
      const eventDate = (item.event_date || '').toLowerCase();
      const eventDateEn = window.CampaignDB ? window.CampaignDB.toEnglishDigits(eventDate) : eventDate;
      const id = (item.id || '').toLowerCase();

      const matchName = campaignName.includes(q) || campaignName.includes(qEn);
      const matchTitle = campaignTitle.includes(q) || campaignTitle.includes(qEn);
      const matchOrganizer = organizerName.includes(q) || organizerName.includes(qEn);
      const matchPhone = (qDigits.length >= 2 && phoneDigits.includes(qDigits)) || phone.includes(q) || phoneEn.includes(qEn);
      const matchEventDate = eventDate.includes(q) || eventDateEn.includes(qEn);
      const matchId = id.includes(qEn);

      if (!matchName && !matchTitle && !matchOrganizer && !matchPhone && !matchEventDate && !matchId) {
        return false;
      }
    }

    if (cooperationFilters.dateQuick && cooperationFilters.dateQuick !== 'all') {
      const createdAt = new Date(item.created_at || Date.now()).getTime();
      const now = Date.now();
      const oneDay = 24 * 60 * 60 * 1000;
      if (cooperationFilters.dateQuick === 'today') {
        if (now - createdAt > oneDay) return false;
      } else if (cooperationFilters.dateQuick === 'yesterday') {
        if (now - createdAt <= oneDay || now - createdAt > 2 * oneDay) return false;
      } else if (cooperationFilters.dateQuick === 'week') {
        if (now - createdAt > 7 * oneDay) return false;
      } else if (cooperationFilters.dateQuick === 'month') {
        if (now - createdAt > 30 * oneDay) return false;
      }
    }

    if (cooperationFilters.date) {
      const qDate = cooperationFilters.date.trim();
      const qDateEn = window.CampaignDB ? window.CampaignDB.toEnglishDigits(qDate) : qDate;
      const dateObj = item.created_at ? new Date(item.created_at) : null;
      const eventDate = item.event_date || '';
      const eventDateEn = window.CampaignDB ? window.CampaignDB.toEnglishDigits(eventDate) : eventDate;

      let matchCreated = false;
      if (dateObj) {
        const pDate = dateObj.toLocaleDateString('fa-IR');
        const pDateEn = window.CampaignDB ? window.CampaignDB.toEnglishDigits(pDate) : pDate;
        const isoDate = item.created_at ? item.created_at.slice(0, 10) : '';
        matchCreated = pDate.includes(qDate) || pDateEn.includes(qDateEn) || isoDate.includes(qDateEn);
      }
      const matchEvent = eventDate.includes(qDate) || eventDateEn.includes(qDateEn);

      if (!matchCreated && !matchEvent) {
        return false;
      }
    }

    return true;
  });

  // اولویت اکید چینش از قدیم به جدید بر اساس تاریخ (صعودی)
  filtered.sort((a, b) => {
    const timeA = new Date(a.created_at || 0).getTime();
    const timeB = new Date(b.created_at || 0).getTime();
    return timeA - timeB;
  });

  return filtered;
}

function renderCooperationTable() {
  updateCooperationBadges();

  const tbody = document.getElementById('cooperationTableBody');
  const emptyState = document.getElementById('cooperationEmptyState');
  if (!tbody) return;

  const filtered = getFilteredCooperations();
  const resultsCountEl = document.getElementById('cooperationResultsCount');
  if (resultsCountEl) {
    resultsCountEl.textContent = window.CampaignDB ? window.CampaignDB.toPersianDigits(filtered.length) : filtered.length;
  }

  if (filtered.length === 0) {
    tbody.innerHTML = '';
    if (emptyState) emptyState.style.display = 'block';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';

  tbody.innerHTML = filtered.map((c, idx) => {
    const dateObj = c.created_at ? new Date(c.created_at) : new Date();
    const persianDate = dateObj.toLocaleDateString('fa-IR');
    const persianTime = dateObj.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
    const cleanPhone = String(c.organizer_phone || '').trim();
    const cleanPhoneFa = window.CampaignDB ? window.CampaignDB.toPersianDigits(cleanPhone) : cleanPhone;
    const eventDateFa = window.CampaignDB ? window.CampaignDB.toPersianDigits(c.event_date || '-') : (c.event_date || '-');
    const st = c.status || 'open';

    let statusHtml = '';
    if (st === 'open') {
      statusHtml = '<span class="ticket-status-pill ticket-status-open"><span style="width: 6px; height: 6px; border-radius: 50%; background: #e11d48;"></span>درحال انتظار</span>';
    } else {
      statusHtml = '<span class="ticket-status-pill ticket-status-answered"><span style="width: 6px; height: 6px; border-radius: 50%; background: #059669;"></span>پاسخ داده شده</span>';
    }

    let actionButtonsHtml = '';
    if (st === 'open') {
      actionButtonsHtml = `
        <button type="button" class="btn-row-action btn-ticket-close" onclick="handleCooperationCloseAction('${c.id}', 'open', event)" title="بستن درخواست (پیگیری شده و انتقال به لیست پاسخ داده شده)">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          <span>بستن</span>
        </button>
        <button type="button" class="btn-row-action btn-ticket-delete" onclick="confirmDeleteCooperation('${c.id}', event)" title="حذف این درخواست">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          <span>حذف</span>
        </button>
        <button type="button" class="btn-row-action btn-ticket-view" onclick="openCooperationDetailsModal('${c.id}')" title="مشاهده کامل مشخصات و یادداشت‌ها">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          <span>مشاهده</span>
        </button>
      `;
    } else {
      actionButtonsHtml = `
        <button type="button" class="btn-row-action" style="color: #0284c7; background: #f0f9ff; border-color: #bae6fd; font-weight: 700;" onclick="handleCooperationReopenAction('${c.id}', event)" title="بازگشایی درخواست و بازگشت به لیست درحال انتظار">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
          <span>بازگشایی</span>
        </button>
        <button type="button" class="btn-row-action btn-ticket-delete" onclick="confirmDeleteCooperation('${c.id}', event)" title="حذف این درخواست">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          <span>حذف</span>
        </button>
        <button type="button" class="btn-row-action btn-ticket-view" onclick="openCooperationDetailsModal('${c.id}')" title="مشاهده کامل مشخصات و یادداشت‌ها">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          <span>مشاهده</span>
        </button>
      `;
    }

    return `
      <tr>
        <td style="font-weight: 700; color: #64748b; font-size: 0.84rem;">${window.CampaignDB ? window.CampaignDB.toPersianDigits(idx + 1) : (idx + 1)}</td>
        <td style="max-width: 220px;">
          <div style="font-weight: 800; color: #1e3a8a; font-size: 0.92rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(c.campaign_name || '')}">
            ${escapeHtml(c.campaign_name || 'بدون نام')}
          </div>
          <div style="font-size: 0.78rem; color: #64748b; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(c.campaign_title || '')}">
            ${escapeHtml(c.campaign_title || '-')}
          </div>
        </td>
        <td>
          <div style="font-weight: 800; color: #1e293b;">${escapeHtml(c.organizer_name || 'ناشناس')}</div>
        </td>
        <td>
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="font-family: monospace; font-weight: 700; color: #0f172a; direction: ltr; font-size: 0.88rem;">${cleanPhoneFa}</span>
            <button type="button" class="btn-copy-tag" onclick="copyPhoneNumber('${cleanPhone}', event)" title="کپی شماره تلفن همراه">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
              <span>کپی</span>
            </button>
          </div>
        </td>
        <td>
          <div style="font-weight: 800; color: #0d9488; font-size: 0.86rem; direction: ltr; text-align: right;">${eventDateFa}</div>
        </td>
        <td>
          <div style="font-size: 0.84rem; font-weight: 700; color: #334155;">${persianDate}</div>
          <div style="font-size: 0.74rem; color: #94a3b8; margin-top: 1px;">ساعت ${persianTime}</div>
        </td>
        <td>${statusHtml}</td>
        <td>
          <div style="display: flex; gap: 6px; align-items: center; justify-content: center; flex-wrap: nowrap;">
            ${actionButtonsHtml}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

async function handleCooperationCloseAction(coopId, currentStatus, e) {
  if (e && e.stopPropagation) e.stopPropagation();
  if (!coopId) return;
  try {
    await window.CampaignDB.updateCooperationStatus(coopId, 'answered');
    showAdminToast('درخواست با موفقیت پیگیری شد و به لیست «پاسخ داده شده» منتقل گردید.', 'success');
    const modal = document.getElementById('modalCooperationDetails');
    if (modal && modal.classList.contains('open')) {
      modal.classList.remove('open');
    }
    await loadCooperationData();
    renderCooperationTable();
  } catch (err) {
    showAdminToast(`خطا در تغییر وضعیت درخواست: ${err.message}`, 'error');
  }
}
window.handleCooperationCloseAction = handleCooperationCloseAction;

async function handleCooperationReopenAction(coopId, e) {
  if (e && e.stopPropagation) e.stopPropagation();
  if (!coopId) return;
  try {
    await window.CampaignDB.updateCooperationStatus(coopId, 'open');
    showAdminToast('درخواست بازگشایی شد و به لیست «درحال انتظار» بازگشت.', 'info');
    const modal = document.getElementById('modalCooperationDetails');
    if (modal && modal.classList.contains('open')) {
      modal.classList.remove('open');
    }
    await loadCooperationData();
    renderCooperationTable();
  } catch (err) {
    showAdminToast(`خطا در بازگشایی درخواست: ${err.message}`, 'error');
  }
}
window.handleCooperationReopenAction = handleCooperationReopenAction;

async function confirmDeleteCooperation(coopId, e) {
  if (e && e.stopPropagation) e.stopPropagation();
  const c = allCooperations.find(x => String(x.id) === String(coopId));
  const title = c ? (c.campaign_name || c.organizer_name || 'درخواست') : 'درخواست';
  const ok = await showAdminConfirm({
    title: 'تایید حذف درخواست',
    message: `آیا از حذف درخواست «${title}» اطمینان دارید؟`,
    subtext: 'این درخواست به بخش زباله‌دان منتقل خواهد شد و در صورت لزوم قابل بازیابی است.',
    confirmText: 'بله، حذف درخواست',
    danger: true
  });
  if (!ok) return;

  try {
    await window.CampaignDB.deleteCooperation(coopId);
    showAdminToast('درخواست با موفقیت به زباله‌دان منتقل شد.', 'success');
    const modal = document.getElementById('modalCooperationDetails');
    if (modal && modal.classList.contains('open')) {
      modal.classList.remove('open');
    }
    await loadCooperationData();
    renderCooperationTable();
    await loadTrashData();
  } catch (err) {
    showAdminToast(`خطا در حذف درخواست: ${err.message}`, 'error');
  }
}
window.confirmDeleteCooperation = confirmDeleteCooperation;

async function openCooperationDetailsModal(coopId) {
  try {
    currentViewingCooperationId = coopId;
    const item = await window.CampaignDB.getCooperationById(coopId);
    if (!item) {
      showAdminToast('اطلاعات درخواست یافت نشد.', 'error');
      return;
    }
    const modal = document.getElementById('modalCooperationDetails');
    if (!modal) return;

    const idInput = document.getElementById('cooperationModalCurrentId');
    if (idInput) idInput.value = item.id || '';

    const modalIdEl = document.getElementById('cooperationModalId');
    if (modalIdEl) modalIdEl.textContent = `شناسه درخواست: ${item.id || '-'}`;

    const campNameEl = document.getElementById('coopDetailCampaignName');
    if (campNameEl) campNameEl.textContent = item.campaign_name || 'بدون نام';

    const campTitleEl = document.getElementById('coopDetailCampaignTitle');
    if (campTitleEl) campTitleEl.textContent = item.campaign_title || 'بدون عنوان';

    const orgNameEl = document.getElementById('coopDetailOrganizerName');
    if (orgNameEl) orgNameEl.textContent = item.organizer_name || 'ناشناس';

    const orgPhoneEl = document.getElementById('coopDetailOrganizerPhone');
    const cleanPhone = String(item.organizer_phone || '').trim();
    if (orgPhoneEl) orgPhoneEl.textContent = window.CampaignDB ? window.CampaignDB.toPersianDigits(cleanPhone) : cleanPhone;

    const btnCopy = document.getElementById('btnCopyCoopPhone');
    if (btnCopy) {
      btnCopy.onclick = (e) => copyPhoneNumber(cleanPhone, e);
    }

    const btnCall = document.getElementById('btnCallCoopApplicant');
    if (btnCall) {
      btnCall.href = `tel:${cleanPhone}`;
    }

    const eventDateEl = document.getElementById('coopDetailEventDate');
    if (eventDateEl) eventDateEl.textContent = window.CampaignDB ? window.CampaignDB.toPersianDigits(item.event_date || '-') : (item.event_date || '-');

    const dateObj = item.created_at ? new Date(item.created_at) : new Date();
    const createdAtEl = document.getElementById('coopDetailCreatedAt');
    if (createdAtEl) {
      createdAtEl.textContent = `${dateObj.toLocaleDateString('fa-IR')} ساعت ${dateObj.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })}`;
    }

    const messagesListEl = document.getElementById('coopModalMessagesList');
    if (messagesListEl) {
      const msgs = Array.isArray(item.messages) && item.messages.length > 0
        ? item.messages
        : [{
            sender_type: 'organizer',
            sender_name: item.organizer_name,
            message: `درخواست ثبت و همکاری در پویش «${item.campaign_name || ''}» با عنوان «${item.campaign_title || ''}» برای تاریخ «${item.event_date || ''}».`,
            created_at: item.created_at
          }];

      messagesListEl.innerHTML = msgs.map(m => {
        const isOrganizer = m.sender_type === 'organizer' || m.sender_type === 'user';
        const mDate = m.created_at ? new Date(m.created_at).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }) : '';
        return `
          <div style="background: ${isOrganizer ? '#eff6ff' : '#f0fdfa'}; border: 1px solid ${isOrganizer ? '#bfdbfe' : '#ccfbf1'}; border-radius: 12px; padding: 14px 16px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-size: 0.8rem;">
              <span style="font-weight: 800; color: ${isOrganizer ? '#1d4ed8' : '#0d9488'};">${isOrganizer ? (escapeHtml(m.sender_name || item.organizer_name) + ' (برگزارکننده)') : 'مدیریت سامانه'}</span>
              <span style="color: #94a3b8;">${mDate}</span>
            </div>
            <div style="font-size: 0.9rem; line-height: 1.8; color: #334155; white-space: pre-wrap;">${escapeHtml(m.message || '')}</div>
          </div>
        `;
      }).join('');
    }

    const statusContainer = document.getElementById('coopModalStatusContainer');
    const st = item.status || 'open';
    if (statusContainer) {
      if (st === 'open') {
        statusContainer.innerHTML = '<span class="ticket-status-pill ticket-status-open"><span style="width: 6px; height: 6px; border-radius: 50%; background: #e11d48;"></span>درحال انتظار</span>';
      } else {
        statusContainer.innerHTML = '<span class="ticket-status-pill ticket-status-answered"><span style="width: 6px; height: 6px; border-radius: 50%; background: #059669;"></span>پاسخ داده شده (پیگیری شده)</span>';
      }
    }

    const btnResolveModal = document.getElementById('btnResolveModalCooperation');
    const btnResolveText = document.getElementById('btnResolveModalCooperationText');
    if (btnResolveModal && btnResolveText) {
      if (st === 'open') {
        btnResolveText.textContent = 'بستن درخواست (پیگیری شد)';
        btnResolveModal.style.background = '#ecfdf5';
        btnResolveModal.style.color = '#047857';
        btnResolveModal.style.borderColor = '#a7f3d0';
        btnResolveModal.onclick = () => handleCooperationCloseAction(item.id, 'open');
      } else {
        btnResolveText.textContent = 'بازگشایی درخواست (درحال انتظار)';
        btnResolveModal.style.background = '#f0f9ff';
        btnResolveModal.style.color = '#0284c7';
        btnResolveModal.style.borderColor = '#bae6fd';
        btnResolveModal.onclick = () => handleCooperationReopenAction(item.id);
      }
    }

    const btnDeleteModal = document.getElementById('btnDeleteCurrentCooperation');
    if (btnDeleteModal) {
      btnDeleteModal.onclick = (e) => confirmDeleteCooperation(item.id, e);
    }

    modal.classList.add('open');
  } catch (err) {
    showAdminToast(`خطا در باز کردن جزئیات درخواست: ${err.message}`, 'error');
  }
}
window.openCooperationDetailsModal = openCooperationDetailsModal;

function exportCooperationToExcel() {
  const filtered = getFilteredCooperations();
  if (filtered.length === 0) {
    showAdminToast('درخواستی برای خروجی اکسل وجود ندارد.', 'warning');
    return;
  }
  if (typeof window.XLSX === 'undefined') {
    showAdminToast('کتابخانه ساخت فایل اکسل بارگذاری نشده است.', 'error');
    return;
  }

  const statusLabels = {
    open: 'درحال انتظار',
    answered: 'پاسخ داده شده (پیگیری شده)',
    closed: 'بسته شده'
  };

  const exportData = filtered.map((c, idx) => {
    const dateObj = c.created_at ? new Date(c.created_at) : new Date();
    const datePersian = dateObj.toLocaleDateString('fa-IR');
    const timePersian = dateObj.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
    return {
      'ردیف': idx + 1,
      'شناسه درخواست': c.id || '-',
      'نام پویش': c.campaign_name || '-',
      'عنوان پویش': c.campaign_title || '-',
      'نام برگزارکننده': c.organizer_name || 'ناشناس',
      'شماره همراه': c.organizer_phone || '-',
      'تاریخ برگزاری پویش': c.event_date || '-',
      'وضعیت درخواست': statusLabels[c.status] || 'درحال انتظار',
      'تاریخ ثبت': datePersian,
      'ساعت ثبت': timePersian
    };
  });

  const worksheet = window.XLSX.utils.json_to_sheet(exportData);
  worksheet['!cols'] = [
    { wch: 6 },
    { wch: 20 },
    { wch: 25 },
    { wch: 30 },
    { wch: 22 },
    { wch: 16 },
    { wch: 18 },
    { wch: 22 },
    { wch: 14 },
    { wch: 10 }
  ];
  const workbook = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(workbook, worksheet, 'درخواست‌ها');
  const now = new Date();
  const dateStr = now.toLocaleDateString('fa-IR').replace(/\//g, '-');
  const fileName = `گزارش_درخواست‌ها_${dateStr}.xlsx`;
  window.XLSX.writeFile(workbook, fileName);
  showAdminToast(`فایل اکسل با ${window.CampaignDB.toPersianDigits(filtered.length)} درخواست با موفقیت دریافت شد.`, 'success');
}
window.exportCooperationToExcel = exportCooperationToExcel;

function setupCooperationEventListeners() {
  const searchInput = document.getElementById('cooperationFilterSearch');
  if (searchInput && !searchInput._bound) {
    searchInput._bound = true;
    searchInput.addEventListener('input', () => {
      cooperationFilters.search = searchInput.value;
      renderCooperationTable();
    });
  }

  const dateInput = document.getElementById('cooperationFilterDate');
  if (dateInput && !dateInput._bound) {
    dateInput._bound = true;
    dateInput.addEventListener('input', () => {
      cooperationFilters.date = dateInput.value;
      renderCooperationTable();
    });
  }

  const dateQuickSelect = document.getElementById('cooperationFilterDateQuick');
  if (dateQuickSelect && !dateQuickSelect._bound) {
    dateQuickSelect._bound = true;
    dateQuickSelect.addEventListener('change', () => {
      cooperationFilters.dateQuick = dateQuickSelect.value;
      renderCooperationTable();
    });
  }

  const statusSelect = document.getElementById('cooperationFilterStatus');
  if (statusSelect && !statusSelect._bound) {
    statusSelect._bound = true;
    statusSelect.addEventListener('change', () => {
      cooperationFilters.status = statusSelect.value;
      currentCooperationTab = statusSelect.value === 'all' ? 'all' : statusSelect.value;
      document.querySelectorAll('#cooperationSectionTabs .tickets-tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-cooperation-tab') === currentCooperationTab);
      });
      renderCooperationTable();
    });
  }

  const btnReset = document.getElementById('btnResetCooperationFilters');
  if (btnReset && !btnReset._bound) {
    btnReset._bound = true;
    btnReset.addEventListener('click', () => {
      cooperationFilters = { search: '', date: '', dateQuick: 'all', status: 'all' };
      if (searchInput) searchInput.value = '';
      if (dateInput) dateInput.value = '';
      if (dateQuickSelect) dateQuickSelect.value = 'all';
      if (statusSelect) statusSelect.value = 'all';
      currentCooperationTab = 'open';
      document.querySelectorAll('#cooperationSectionTabs .tickets-tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-cooperation-tab') === 'open');
      });
      renderCooperationTable();
      showAdminToast('فیلترها ریست شدند.', 'info');
    });
  }

  const btnExport = document.getElementById('btnExportCooperationExcel');
  if (btnExport && !btnExport._bound) {
    btnExport._bound = true;
    btnExport.addEventListener('click', exportCooperationToExcel);
  }

  const btnRefresh = document.getElementById('btnRefreshCooperation');
  if (btnRefresh && !btnRefresh._bound) {
    btnRefresh._bound = true;
    btnRefresh.addEventListener('click', async () => {
      await loadCooperationData();
      renderCooperationTable();
      showAdminToast('لیست درخواست‌ها بروزرسانی شد.', 'success');
    });
  }

  // ثبت پاسخ یا یادداشت جدید برای درخواست همکاری در مودال
  const formReply = document.getElementById('formCoopReply');
  if (formReply && !formReply._bound) {
    formReply._bound = true;
    formReply.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!currentViewingCooperationId) return;
      const input = document.getElementById('coopReplyMessageInput');
      const message = input ? input.value.trim() : '';
      if (!message) {
        showAdminToast('لطفاً متن یادداشت یا پیام را وارد کنید.', 'warning');
        return;
      }
      try {
        await window.CampaignDB.replyCooperation(currentViewingCooperationId, message);
        if (input) input.value = '';
        showAdminToast('یادداشت / پیام با موفقیت ثبت شد.', 'success');
        await openCooperationDetailsModal(currentViewingCooperationId);
        await loadCooperationData();
        renderCooperationTable();
      } catch (err) {
        showAdminToast(`خطا در ثبت یادداشت: ${err.message}`, 'error');
      }
    });
  }
}

async function renderCooperationSection() {
  await loadCooperationData();
  renderCooperationTable();
  setupCooperationEventListeners();
}
window.renderCooperationSection = renderCooperationSection;
window.loadCooperationData = loadCooperationData;
window.setupCooperationEventListeners = setupCooperationEventListeners;

// =============================================================
// بخش مدیریت پیام‌ها و تیکت‌های پشتیبانی (Support Tickets Management)
// =============================================================
let allTickets = [];
let currentTicketTab = 'open'; // 'open' (درحال انتظار) | 'answered' (پاسخ داده شده) | 'closed' (بسته شده) | 'all'
let ticketFilters = {
  search: '',
  date: '',
  dateQuick: 'all',
  status: 'all'
};
let currentViewingTicketId = null;

async function loadTicketsData() {
  try {
    const data = await window.CampaignDB.getTickets();
    allTickets = Array.isArray(data) ? data : [];
    // مرتب‌سازی پایه بر اساس تاریخ از قدیم به جدید (صعودی)
    allTickets.sort((a, b) => {
      const timeA = new Date(a.created_at || 0).getTime();
      const timeB = new Date(b.created_at || 0).getTime();
      return timeA - timeB;
    });
    updateTicketsBadges();
  } catch (err) {
    console.error('خطا در دریافت لیست تیکت‌ها:', err);
    allTickets = [];
  }
}

window.switchTicketsTab = function(tabName) {
  currentTicketTab = tabName;
  const tabBtns = document.querySelectorAll('.tickets-tab-btn');
  tabBtns.forEach(btn => {
    if (btn.getAttribute('data-ticket-tab') === tabName) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // هماهنگ‌سازی با فیلتر دراپ‌داون در صورت وجود
  const statusSelect = document.getElementById('ticketsFilterStatus');
  if (statusSelect) {
    if (tabName === 'open' || tabName === 'answered' || tabName === 'closed') {
      statusSelect.value = tabName;
      ticketFilters.status = tabName;
    } else {
      statusSelect.value = 'all';
      ticketFilters.status = 'all';
    }
  }

  renderTicketsTable();
};

function updateTicketsBadges() {
  const openCount = allTickets.filter(t => t.status === 'open' || !t.status).length;
  const answeredCount = allTickets.filter(t => t.status === 'answered').length;
  const closedCount = allTickets.filter(t => t.status === 'closed').length;
  const totalCount = allTickets.length;

  const badgeEl = document.getElementById('sidebarTicketsBadge');
  if (badgeEl) {
    if (openCount > 0) {
      badgeEl.textContent = window.CampaignDB.toPersianDigits(openCount);
      badgeEl.style.display = 'inline-block';
    } else {
      badgeEl.style.display = 'none';
    }
  }

  const elTotal = document.getElementById('ticketsStatTotal');
  const elOpen = document.getElementById('ticketsStatOpen');
  const elAnswered = document.getElementById('ticketsStatAnswered');
  const elClosed = document.getElementById('ticketsStatClosed');

  if (elTotal) elTotal.textContent = window.CampaignDB.toPersianDigits(totalCount);
  if (elOpen) elOpen.textContent = window.CampaignDB.toPersianDigits(openCount);
  if (elAnswered) elAnswered.textContent = window.CampaignDB.toPersianDigits(answeredCount);
  if (elClosed) elClosed.textContent = window.CampaignDB.toPersianDigits(closedCount);

  const badgeTabOpen = document.getElementById('badgeTicketsTabOpen');
  const badgeTabAnswered = document.getElementById('badgeTicketsTabAnswered');
  const badgeTabClosed = document.getElementById('badgeTicketsTabClosed');
  if (badgeTabOpen) badgeTabOpen.textContent = window.CampaignDB.toPersianDigits(openCount);
  if (badgeTabAnswered) badgeTabAnswered.textContent = window.CampaignDB.toPersianDigits(answeredCount);
  if (badgeTabClosed) badgeTabClosed.textContent = window.CampaignDB.toPersianDigits(closedCount);
}

function getFilteredTickets() {
  const filtered = allTickets.filter(t => {
    const st = t.status || 'open';

    // فیلتر بر اساس تب‌های ۳‌گانه (درحال انتظار، پاسخ داده شده، بسته شده)
    if (currentTicketTab && currentTicketTab !== 'all') {
      if (currentTicketTab === 'open' && st !== 'open') return false;
      if (currentTicketTab === 'answered' && st !== 'answered') return false;
      if (currentTicketTab === 'closed' && st !== 'closed') return false;
    }

    // جستجو بر اساس نام و نام خانوادگی، شماره همراه، تاریخ، کد رهگیری، متن پیام
    if (ticketFilters.search) {
      const q = ticketFilters.search.toLowerCase().trim();
      const qEn = window.CampaignDB ? window.CampaignDB.toEnglishDigits(q) : q;
      const qDigits = qEn.replace(/\D/g, '');

      const name = (t.name || '').toLowerCase();
      const phone = (t.phone || '').toLowerCase();
      const phoneEn = window.CampaignDB ? window.CampaignDB.toEnglishDigits(phone) : phone;
      const phoneDigits = phoneEn.replace(/\D/g, '');
      const phoneFa = window.CampaignDB ? window.CampaignDB.toPersianDigits(phoneEn) : '';

      const subject = (t.subject || '').toLowerCase();
      const message = (t.message || '').toLowerCase();
      const tracking = (t.tracking_code || '').toLowerCase();
      const trackingEn = window.CampaignDB ? window.CampaignDB.toEnglishDigits(tracking) : tracking;
      const id = (t.id || '').toLowerCase();

      // تاریخ‌های پیام
      const dateObj = t.created_at ? new Date(t.created_at) : null;
      let persianDate = '';
      let persianDateEn = '';
      let isoDate = t.created_at ? t.created_at.slice(0, 10) : '';
      if (dateObj) {
        persianDate = dateObj.toLocaleDateString('fa-IR');
        persianDateEn = window.CampaignDB ? window.CampaignDB.toEnglishDigits(persianDate) : persianDate;
      }

      const matchName = name.includes(q) || name.includes(qEn);
      const matchPhone = (qDigits.length >= 2 && phoneDigits.includes(qDigits)) || phone.includes(q) || phoneEn.includes(qEn) || (phoneFa && phoneFa.includes(q));
      const matchDate = (persianDate && persianDate.includes(q)) || (persianDateEn && persianDateEn.includes(qEn)) || (isoDate && isoDate.includes(qEn));
      const matchTracking = tracking.includes(q) || trackingEn.includes(qEn);
      const matchText = subject.includes(q) || subject.includes(qEn) || message.includes(q) || message.includes(qEn) || id.includes(qEn);

      if (!matchName && !matchPhone && !matchDate && !matchTracking && !matchText) {
        return false;
      }
    }

    // فیلتر وضعیت دراپ‌داون (اگر اختصاصی تعیین شده باشد)
    if (ticketFilters.status && ticketFilters.status !== 'all') {
      if (st !== ticketFilters.status) {
        return false;
      }
    }

    // بازه زمانی سریع
    if (ticketFilters.dateQuick && ticketFilters.dateQuick !== 'all') {
      const createdAt = new Date(t.created_at || Date.now()).getTime();
      const now = Date.now();
      const oneDay = 24 * 60 * 60 * 1000;
      if (ticketFilters.dateQuick === 'today') {
        if (now - createdAt > oneDay) return false;
      } else if (ticketFilters.dateQuick === 'yesterday') {
        if (now - createdAt <= oneDay || now - createdAt > 2 * oneDay) return false;
      } else if (ticketFilters.dateQuick === 'week') {
        if (now - createdAt > 7 * oneDay) return false;
      } else if (ticketFilters.dateQuick === 'month') {
        if (now - createdAt > 30 * oneDay) return false;
      }
    }

    // فیلتر متنی تاریخ
    if (ticketFilters.date) {
      const qDate = ticketFilters.date.trim();
      const qDateEn = window.CampaignDB ? window.CampaignDB.toEnglishDigits(qDate) : qDate;
      const dateObj = t.created_at ? new Date(t.created_at) : null;
      if (!dateObj) return false;
      const persianDate = dateObj.toLocaleDateString('fa-IR');
      const persianDateEn = window.CampaignDB ? window.CampaignDB.toEnglishDigits(persianDate) : persianDate;
      const isoDate = t.created_at ? t.created_at.slice(0, 10) : '';
      const enDate = dateObj.toLocaleDateString('en-US');
      if (!persianDate.includes(qDate) && !persianDateEn.includes(qDateEn) && !isoDate.includes(qDateEn) && !enDate.includes(qDateEn)) {
        return false;
      }
    }

    return true;
  });

  // اولویت اکید چینش پیام‌ها از قدیم به جدید بر اساس تاریخ (صعودی)
  filtered.sort((a, b) => {
    const timeA = new Date(a.created_at || 0).getTime();
    const timeB = new Date(b.created_at || 0).getTime();
    return timeA - timeB;
  });

  return filtered;
}

async function renderTicketsSection() {
  await loadTicketsData();
  renderTicketsTable();
  setupTicketsEventListeners();
}

function renderTicketsTable() {
  const tbody = document.getElementById('ticketsTableBody');
  if (!tbody) return;

  const filtered = getFilteredTickets();
  const countEl = document.getElementById('ticketsResultsCount');
  if (countEl) countEl.textContent = window.CampaignDB.toPersianDigits(filtered.length);

  const tabLabels = {
    open: 'درحال انتظار',
    answered: 'پاسخ داده شده',
    closed: 'بسته شده',
    all: 'کل پیام‌ها'
  };
  const activeLabel = tabLabels[currentTicketTab] || 'این بخش';

  const infoEl = document.getElementById('ticketsPaginationInfo');
  if (infoEl) infoEl.textContent = `نمایش ${window.CampaignDB.toPersianDigits(filtered.length)} پیام در بخش «${activeLabel}» (مرتب‌شده از قدیم به جدید)`;

  if (filtered.length === 0) {
    let emptyTitle = 'هیچ پیامی در این بخش وجود ندارد';
    let emptyDesc = 'در حال حاضر پیامی در این وضعیت ثبت نشده است.';
    if (currentTicketTab === 'open') {
      emptyTitle = 'هیچ پیامی درحال انتظار نیست';
      emptyDesc = 'تمامی پیام‌های پشتیبانی پیگیری و پاسخ داده شده‌اند.';
    } else if (currentTicketTab === 'answered') {
      emptyTitle = 'پیام پاسخ داده شده‌ای وجود ندارد';
      emptyDesc = 'پیام‌های پیگیری شده پس از زدن دکمه «بستن» به این بخش منتقل می‌شوند.';
    } else if (currentTicketTab === 'closed') {
      emptyTitle = 'پیام بسته شده‌ای وجود ندارد';
      emptyDesc = 'پیام‌های مختومه شده در این بخش نگهداری می‌شوند.';
    }

    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; padding: 48px 20px; color: #64748b;">
          <div style="width: 56px; height: 56px; margin: 0 auto 14px; border-radius: 14px; background: #f0fdfa; color: #0d9488; display: flex; align-items: center; justify-content: center;">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          </div>
          <div style="font-size: 1rem; font-weight: 800; color: #1e293b; margin-bottom: 4px;">${emptyTitle}</div>
          <div style="font-size: 0.84rem; color: #94a3b8;">${emptyDesc}</div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map((t, idx) => {
    const dateObj = t.created_at ? new Date(t.created_at) : new Date();
    const persianDate = dateObj.toLocaleDateString('fa-IR');
    const persianTime = dateObj.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
    const cleanPhone = String(t.phone || '').trim();

    let statusHtml = '';
    const st = t.status || 'open';
    if (st === 'open') {
      statusHtml = '<span class="ticket-status-pill ticket-status-open"><span style="width: 6px; height: 6px; border-radius: 50%; background: #e11d48;"></span>درحال انتظار</span>';
    } else if (st === 'answered') {
      statusHtml = '<span class="ticket-status-pill ticket-status-answered"><span style="width: 6px; height: 6px; border-radius: 50%; background: #059669;"></span>پاسخ داده شده</span>';
    } else {
      statusHtml = '<span class="ticket-status-pill ticket-status-closed"><span style="width: 6px; height: 6px; border-radius: 50%; background: #94a3b8;"></span>بسته شده</span>';
    }

    // دکمه‌های عملیات هر پیام طبق خواسته کاربر:
    // فقط دکمه بستن (به معنی پیگیری شده و انتقال به لیست پاسخ داده شده) و حذف
    let actionButtonsHtml = '';
    if (st === 'open') {
      // پیام درحال انتظار: دکمه بستن (پیگیری شد -> انتقال به پاسخ داده شده) + دکمه حذف
      actionButtonsHtml = `
        <button type="button" class="btn-row-action btn-ticket-close" onclick="handleTicketCloseAction('${t.id}', 'open', event)" title="بستن پیام (پیگیری شده و انتقال به لیست پاسخ داده شده)">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          <span>بستن</span>
        </button>
        <button type="button" class="btn-row-action btn-ticket-delete" onclick="confirmDeleteTicket('${t.id}', event)" title="حذف این پیام پشتیبانی">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          <span>حذف</span>
        </button>
        <button type="button" class="btn-row-action btn-ticket-view" onclick="openTicketDetailsModal('${t.id}')" title="مشاهده کامل پیام و اطلاعات">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          <span>مشاهده</span>
        </button>
      `;
    } else if (st === 'answered') {
      // پیام پاسخ داده شده: دکمه بستن نهایی (انتقال به بسته شده) + دکمه حذف
      actionButtonsHtml = `
        <button type="button" class="btn-row-action btn-ticket-close" style="color: #475569; background: #f1f5f9; border-color: #cbd5e1;" onclick="handleTicketCloseAction('${t.id}', 'answered', event)" title="بستن پیام و انتقال به لیست پیام‌های بسته شده">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          <span>بستن</span>
        </button>
        <button type="button" class="btn-row-action btn-ticket-delete" onclick="confirmDeleteTicket('${t.id}', event)" title="حذف این پیام پشتیبانی">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          <span>حذف</span>
        </button>
        <button type="button" class="btn-row-action btn-ticket-view" onclick="openTicketDetailsModal('${t.id}')" title="مشاهده کامل پیام و اطلاعات">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          <span>مشاهده</span>
        </button>
      `;
    } else {
      // پیام بسته شده: دکمه بازگشایی + دکمه حذف
      actionButtonsHtml = `
        <button type="button" class="btn-row-action" style="color: #0284c7; background: #f0f9ff; border-color: #bae6fd; font-weight: 700;" onclick="handleTicketReopenAction('${t.id}', event)" title="بازگشایی پیام و بازگشت به لیست درحال انتظار">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
          <span>بازگشایی</span>
        </button>
        <button type="button" class="btn-row-action btn-ticket-delete" onclick="confirmDeleteTicket('${t.id}', event)" title="حذف این پیام پشتیبانی">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          <span>حذف</span>
        </button>
        <button type="button" class="btn-row-action btn-ticket-view" onclick="openTicketDetailsModal('${t.id}')" title="مشاهده کامل پیام و اطلاعات">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          <span>مشاهده</span>
        </button>
      `;
    }

    return `
      <tr>
        <td style="font-weight: 700; color: #64748b; font-size: 0.84rem;">${window.CampaignDB.toPersianDigits(idx + 1)}</td>
        <td>
          <div style="font-weight: 800; color: #1e293b;">${escapeHtml(t.name || 'بدون نام')}</div>
        </td>
        <td>
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="font-family: monospace; font-weight: 700; color: #0f172a; direction: ltr; font-size: 0.88rem;">${window.CampaignDB.toPersianDigits(cleanPhone)}</span>
            <button type="button" class="btn-copy-tag" onclick="copyPhoneNumber('${cleanPhone}', event)" title="کپی شماره تلفن همراه">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
              <span>کپی</span>
            </button>
          </div>
        </td>
        <td style="max-width: 280px;">
          <div style="font-weight: 700; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(t.subject || 'درخواست پشتیبانی')}</div>
          <div style="font-size: 0.79rem; color: #64748b; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(t.message || '-')}</div>
        </td>
        <td>
          ${t.tracking_code ? `<span style="font-family: monospace; font-weight: 700; color: #0d9488; background: #f0fdfa; border: 1px solid #ccfbf1; padding: 2px 7px; border-radius: 6px; font-size: 0.8rem; direction: ltr; display: inline-block;">${escapeHtml(t.tracking_code)}</span>` : '<span style="color: #cbd5e1;">-</span>'}
        </td>
        <td>
          <div style="font-size: 0.84rem; font-weight: 700; color: #334155;">${persianDate}</div>
          <div style="font-size: 0.74rem; color: #94a3b8; margin-top: 1px;">ساعت ${persianTime}</div>
        </td>
        <td>${statusHtml}</td>
        <td>
          <div style="display: flex; gap: 6px; align-items: center; justify-content: center; flex-wrap: nowrap;">
            ${actionButtonsHtml}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// بستن پیام (به معنی پیگیری شده و انتقال به لیست پیام‌های پاسخ داده شده)
async function handleTicketCloseAction(ticketId, currentStatus, e) {
  if (e && e.stopPropagation) e.stopPropagation();
  if (!ticketId) return;

  try {
    if (currentStatus === 'open' || !currentStatus) {
      // پیام درحال انتظار است: تغییر وضعیت به پاسخ داده شده (پیگیری شده)
      await window.CampaignDB.updateTicketStatus(ticketId, 'answered');
      showAdminToast('پیام با موفقیت پیگیری شد و به لیست «پاسخ داده شده» منتقل گردید.', 'success');
    } else if (currentStatus === 'answered') {
      // پیام در وضعیت پاسخ داده شده است: بستن نهایی پیام (مختومه)
      await window.CampaignDB.updateTicketStatus(ticketId, 'closed');
      showAdminToast('پیام با موفقیت بسته و به لیست «بسته شده» منتقل گردید.', 'success');
    }

    const modal = document.getElementById('modalTicketDetails');
    if (modal && modal.classList.contains('open')) {
      modal.classList.remove('open');
    }

    await loadTicketsData();
    renderTicketsTable();
  } catch (err) {
    showAdminToast(`خطا در تغییر وضعیت پیام: ${err.message}`, 'error');
  }
}

window.handleTicketCloseAction = handleTicketCloseAction;

// بازگشایی پیام و بازگرداندن به لیست درحال انتظار
async function handleTicketReopenAction(ticketId, e) {
  if (e && e.stopPropagation) e.stopPropagation();
  if (!ticketId) return;

  try {
    await window.CampaignDB.updateTicketStatus(ticketId, 'open');
    showAdminToast('پیام بازگشایی شد و به لیست «درحال انتظار» بازگشت.', 'info');

    const modal = document.getElementById('modalTicketDetails');
    if (modal && modal.classList.contains('open')) {
      modal.classList.remove('open');
    }

    await loadTicketsData();
    renderTicketsTable();
  } catch (err) {
    showAdminToast(`خطا در بازگشایی پیام: ${err.message}`, 'error');
  }
}

window.handleTicketReopenAction = handleTicketReopenAction;

window.copyPhoneNumber = function(phone, e) {
  if (e && e.stopPropagation) e.stopPropagation();
  if (!phone) return;
  const clean = String(phone).trim();
  const persianPhone = window.CampaignDB ? window.CampaignDB.toPersianDigits(clean) : clean;

  let btn = null;
  if (e && e.currentTarget) {
    btn = e.currentTarget;
  } else if (e && e.target) {
    btn = e.target.closest('button');
  }

  const triggerFeedback = () => {
    showAdminToast(`شماره ${persianPhone} با موفقیت کپی شد`, 'success');
    if (btn) {
      const originalHtml = btn.innerHTML;
      btn.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        <span style="color: #059669; font-weight: 800;">کپی شد</span>
      `;
      btn.style.borderColor = '#059669';
      btn.style.backgroundColor = '#ecfdf5';
      setTimeout(() => {
        btn.innerHTML = originalHtml;
        btn.style.borderColor = '';
        btn.style.backgroundColor = '';
      }, 1800);
    }
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(clean).then(() => {
      triggerFeedback();
    }).catch(() => {
      fallbackCopyText(clean, triggerFeedback);
    });
  } else {
    fallbackCopyText(clean, triggerFeedback);
  }
};

function fallbackCopyText(text, callback) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    document.execCommand('copy');
    if (callback) callback();
    else showAdminToast(`شماره ${window.CampaignDB.toPersianDigits(text)} با موفقیت کپی شد`, 'success');
  } catch (err) {
    showAdminToast('خطا در کپی کردن شماره', 'error');
  }
  document.body.removeChild(ta);
}

function exportTicketsToExcel() {
  const filtered = getFilteredTickets();
  if (filtered.length === 0) {
    showAdminToast('پیامی برای خروجی اکسل وجود ندارد.', 'warning');
    return;
  }
  if (typeof window.XLSX === 'undefined') {
    showAdminToast('کتابخانه ساخت فایل اکسل بارگذاری نشده است.', 'error');
    return;
  }
  const statusLabels = {
    open: 'درحال انتظار',
    answered: 'پاسخ داده شده (پیگیری شده)',
    closed: 'بسته شده (مختومه)'
  };

  // خروجی اکسل نیز با اولویت از قدیم به جدید بر اساس تاریخ
  const exportData = filtered.map((t, idx) => {
    const dateObj = t.created_at ? new Date(t.created_at) : new Date();
    const datePersian = dateObj.toLocaleDateString('fa-IR');
    const timePersian = dateObj.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
    return {
      'ردیف': idx + 1,
      'شناسه پیام': t.id || '-',
      'نام و نام خانوادگی': t.name || 'بدون نام',
      'شماره تلفن همراه': t.phone || '-',
      'موضوع پیام': t.subject || 'پشتیبانی',
      'متن پیام کاربر': t.message || '',
      'کد پیگیری تراکنش': t.tracking_code || '-',
      'بخش / وضعیت': statusLabels[t.status] || 'درحال انتظار',
      'تاریخ ثبت': datePersian,
      'ساعت ثبت': timePersian
    };
  });
  const worksheet = window.XLSX.utils.json_to_sheet(exportData);
  worksheet['!cols'] = [
    { wch: 6 },
    { wch: 18 },
    { wch: 22 },
    { wch: 16 },
    { wch: 25 },
    { wch: 45 },
    { wch: 18 },
    { wch: 22 },
    { wch: 14 },
    { wch: 10 }
  ];
  const workbook = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(workbook, worksheet, 'پیام‌های پشتیبانی');
  const now = new Date();
  const dateStr = now.toLocaleDateString('fa-IR').replace(/\//g, '-');
  const fileName = `گزارش_پیام‌های_پشتیبانی_پویش_${dateStr}.xlsx`;
  window.XLSX.writeFile(workbook, fileName);
  showAdminToast(`فایل اکسل با ${window.CampaignDB.toPersianDigits(filtered.length)} پیام با موفقیت دریافت شد.`, 'success');
}

window.exportTicketsToExcel = exportTicketsToExcel;

async function openTicketDetailsModal(ticketId) {
  try {
    currentViewingTicketId = ticketId;
    const ticket = await window.CampaignDB.getTicketById(ticketId);
    if (!ticket) {
      showAdminToast('اطلاعات تیکت یافت نشد.', 'error');
      return;
    }

    const modal = document.getElementById('modalTicketDetails');
    if (!modal) return;

    document.getElementById('ticketModalSubject').textContent = ticket.subject || 'پیام پشتیبانی';
    document.getElementById('ticketModalId').textContent = `شناسه: ${ticket.id || '-'}`;
    document.getElementById('ticketModalSenderName').textContent = ticket.name || 'بدون نام';
    document.getElementById('ticketModalPhone').textContent = window.CampaignDB.toPersianDigits(ticket.phone || '-');
    document.getElementById('ticketModalTrackingCode').textContent = ticket.tracking_code || '---';

    const dateObj = ticket.created_at ? new Date(ticket.created_at) : new Date();
    document.getElementById('ticketModalDate').textContent = `${dateObj.toLocaleDateString('fa-IR')} ساعت ${dateObj.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })}`;

    const btnCopy = document.getElementById('btnCopyModalPhone');
    if (btnCopy) {
      btnCopy.onclick = (e) => copyPhoneNumber(ticket.phone, e);
    }

    // متن پیام‌های کاربر
    const messagesListEl = document.getElementById('ticketModalMessagesList');
    if (messagesListEl) {
      const msgs = Array.isArray(ticket.messages) && ticket.messages.length > 0 
        ? ticket.messages 
        : [{ sender_type: 'user', sender_name: ticket.name, message: ticket.message || 'بدون متن', created_at: ticket.created_at }];

      messagesListEl.innerHTML = msgs.map(m => {
        const isUser = m.sender_type === 'user';
        const mDate = m.created_at ? new Date(m.created_at).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }) : '';
        return `
          <div style="background: ${isUser ? '#f8fafc' : '#f0fdfa'}; border: 1px solid ${isUser ? '#e2e8f0' : '#ccfbf1'}; border-radius: 12px; padding: 14px 16px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-size: 0.8rem;">
              <span style="font-weight: 800; color: ${isUser ? '#1e293b' : '#0d9488'};">${isUser ? (escapeHtml(m.sender_name || ticket.name) + ' (کاربر)') : 'مدیریت سامانه'}</span>
              <span style="color: #94a3b8;">${mDate}</span>
            </div>
            <div style="font-size: 0.9rem; line-height: 1.8; color: #334155; white-space: pre-wrap;">${escapeHtml(m.message || '')}</div>
          </div>
        `;
      }).join('');
    }

    // تصویر پیوست در صورت وجود
    const imgWrapper = document.getElementById('ticketModalImageWrapper');
    const imgPreview = document.getElementById('ticketModalImagePreview');
    const imgLink = document.getElementById('ticketModalImageLink');
    if (ticket.image_url) {
      imgPreview.src = ticket.image_url;
      imgLink.href = ticket.image_url;
      imgWrapper.style.display = 'block';
    } else {
      imgWrapper.style.display = 'none';
    }

    // وضعیت در بخش وضعیت مودال
    const statusContainer = document.getElementById('ticketModalStatusContainer');
    const st = ticket.status || 'open';
    if (statusContainer) {
      if (st === 'open') {
        statusContainer.innerHTML = '<span class="ticket-status-pill ticket-status-open"><span style="width: 6px; height: 6px; border-radius: 50%; background: #e11d48;"></span>درحال انتظار</span>';
      } else if (st === 'answered') {
        statusContainer.innerHTML = '<span class="ticket-status-pill ticket-status-answered"><span style="width: 6px; height: 6px; border-radius: 50%; background: #059669;"></span>پاسخ داده شده (پیگیری شده)</span>';
      } else {
        statusContainer.innerHTML = '<span class="ticket-status-pill ticket-status-closed"><span style="width: 6px; height: 6px; border-radius: 50%; background: #94a3b8;"></span>بسته شده (مختومه)</span>';
      }
    }

    // دکمه فوتر مودال برای بستن پیام یا بازگشایی
    const btnResolveModal = document.getElementById('btnResolveModalTicket');
    const btnResolveText = document.getElementById('btnResolveModalTicketText');
    if (btnResolveModal && btnResolveText) {
      if (st === 'open') {
        btnResolveText.textContent = 'بستن پیام (پیگیری شد)';
        btnResolveModal.style.background = '#ecfdf5';
        btnResolveModal.style.color = '#047857';
        btnResolveModal.style.borderColor = '#a7f3d0';
        btnResolveModal.onclick = () => handleTicketCloseAction(ticket.id, 'open');
      } else if (st === 'answered') {
        btnResolveText.textContent = 'بستن پیام (انتقال به بسته شده)';
        btnResolveModal.style.background = '#f1f5f9';
        btnResolveModal.style.color = '#475569';
        btnResolveModal.style.borderColor = '#cbd5e1';
        btnResolveModal.onclick = () => handleTicketCloseAction(ticket.id, 'answered');
      } else {
        btnResolveText.textContent = 'بازگشایی پیام (درحال انتظار)';
        btnResolveModal.style.background = '#f0f9ff';
        btnResolveModal.style.color = '#0284c7';
        btnResolveModal.style.borderColor = '#bae6fd';
        btnResolveModal.onclick = () => handleTicketReopenAction(ticket.id);
      }
    }

    modal.classList.add('open');
  } catch (err) {
    showAdminToast(`خطا در باز کردن پیام: ${err.message}`, 'error');
  }
}

window.openTicketDetailsModal = openTicketDetailsModal;

async function confirmDeleteTicket(ticketId, e) {
  if (e && e.stopPropagation) e.stopPropagation();
  const t = allTickets.find(x => String(x.id) === String(ticketId));
  const title = t ? (t.subject || t.sender_name || 'پیام پشتیبانی') : 'پیام پشتیبانی';
  const ok = await showAdminConfirm({
    title: 'تایید حذف پیام پشتیبانی',
    message: `آیا از حذف پیام «${title}» اطمینان دارید؟`,
    subtext: 'این پیام به بخش زباله‌دان منتقل خواهد شد و در صورت لزوم قابل بازیابی است.',
    confirmText: 'بله، حذف پیام',
    danger: true
  });
  if (!ok) return;

  try {
    await window.CampaignDB.deleteTicket(ticketId);
    showAdminToast('پیام پشتیبانی با موفقیت به زباله‌دان منتقل شد.', 'success');
    const modal = document.getElementById('modalTicketDetails');
    if (modal && modal.classList.contains('open')) {
      modal.classList.remove('open');
    }
    await loadTicketsData();
    renderTicketsTable();
    await loadTrashData();
  } catch (err) {
    showAdminToast(`خطا در حذف پیام: ${err.message}`, 'error');
  }
}

window.confirmDeleteTicket = confirmDeleteTicket;

function setupTicketsEventListeners() {
  const searchInput = document.getElementById('ticketsFilterSearch');
  if (searchInput && !searchInput._bound) {
    searchInput._bound = true;
    searchInput.oninput = () => {
      ticketFilters.search = searchInput.value;
      renderTicketsTable();
    };
  }

  const dateInput = document.getElementById('ticketsFilterDate');
  if (dateInput && !dateInput._bound) {
    dateInput._bound = true;
    dateInput.oninput = () => {
      ticketFilters.date = dateInput.value;
      renderTicketsTable();
    };
  }

  const dateQuickSelect = document.getElementById('ticketsFilterDateQuick');
  if (dateQuickSelect && !dateQuickSelect._bound) {
    dateQuickSelect._bound = true;
    dateQuickSelect.onchange = () => {
      ticketFilters.dateQuick = dateQuickSelect.value;
      renderTicketsTable();
    };
  }

  const statusSelect = document.getElementById('ticketsFilterStatus');
  if (statusSelect && !statusSelect._bound) {
    statusSelect._bound = true;
    statusSelect.onchange = () => {
      ticketFilters.status = statusSelect.value;
      if (statusSelect.value === 'open' || statusSelect.value === 'answered' || statusSelect.value === 'closed') {
        switchTicketsTab(statusSelect.value);
      } else {
        renderTicketsTable();
      }
    };
  }

  const btnReset = document.getElementById('btnResetTicketsFilter');
  if (btnReset && !btnReset._bound) {
    btnReset._bound = true;
    btnReset.onclick = () => {
      ticketFilters = { search: '', date: '', dateQuick: 'all', status: 'all' };
      if (searchInput) searchInput.value = '';
      if (dateInput) dateInput.value = '';
      if (dateQuickSelect) dateQuickSelect.value = 'all';
      if (statusSelect) statusSelect.value = 'all';
      switchTicketsTab('open');
      showAdminToast('فیلترها ریست شدند.', 'info');
    };
  }

  const btnExport = document.getElementById('btnExportTicketsExcel');
  if (btnExport && !btnExport._bound) {
    btnExport._bound = true;
    btnExport.onclick = () => exportTicketsToExcel();
  }

  const btnRefresh = document.getElementById('btnRefreshTickets');
  if (btnRefresh && !btnRefresh._bound) {
    btnRefresh._bound = true;
    btnRefresh.onclick = async () => {
      await loadTicketsData();
      renderTicketsTable();
      showAdminToast('لیست پیام‌های پشتیبانی بروزرسانی شد.', 'info');
    };
  }

  const btnDeleteModal = document.getElementById('btnDeleteCurrentTicket');
  if (btnDeleteModal && !btnDeleteModal._bound) {
    btnDeleteModal._bound = true;
    btnDeleteModal.onclick = () => {
      if (currentViewingTicketId) confirmDeleteTicket(currentViewingTicketId);
    };
  }
}

// =============================================================
// بخش مدیریت زباله‌دان سامانه (Trash / Recycle Bin Management)
// =============================================================
let activeTrashTab = 'all';
let trashItemsList = [];
let trashStats = { total: 0, campaigns: 0, payments: 0, users: 0, tickets: 0, admins: 0 };
let selectedTrashIds = new Set();
let trashSearchQuery = '';
let currentViewingTrashId = null;
let pendingTrashAction = null;

async function loadTrashData() {
  try {
    const params = {};
    if (activeTrashTab && activeTrashTab !== 'all') {
      params.type = activeTrashTab;
    }
    if (trashSearchQuery && trashSearchQuery.trim()) {
      params.search = trashSearchQuery.trim();
    }
    const res = await window.CampaignDB.getTrash(params);
    if (res && res.success) {
      trashItemsList = Array.isArray(res.data) ? res.data : [];
      if (res.stats) {
        trashStats = {
          total: Number(res.stats.total) || 0,
          campaigns: Number(res.stats.campaigns) || 0,
          payments: Number(res.stats.payments) || 0,
          users: Number(res.stats.users) || 0,
          tickets: Number(res.stats.tickets) || 0,
          admins: Number(res.stats.admins) || 0
        };
      }
    } else {
      trashItemsList = [];
    }
  } catch (err) {
    console.error('خطا در دریافت داده‌های زباله‌دان:', err);
    trashItemsList = [];
  }
  updateTrashSidebarBadge();
}

function updateTrashSidebarBadge() {
  const badge = document.getElementById('sidebarTrashBadge');
  if (badge) {
    const count = trashStats.total || 0;
    badge.textContent = window.CampaignDB ? window.CampaignDB.formatNumber(count) : String(count);
    badge.style.display = count > 0 ? 'inline-flex' : 'none';
  }
}

async function switchTrashTab(tab) {
  activeTrashTab = tab || 'all';
  selectedTrashIds.clear();

  // بروزرسانی استایل دکمه‌های تب
  const tabBtns = document.querySelectorAll('#trashSectionTabs .trash-tab-btn');
  tabBtns.forEach(b => {
    const t = b.getAttribute('data-trash-tab');
    b.classList.toggle('active', t === activeTrashTab);
  });

  // بروزرسانی استایل کارت‌های شاخص
  const statCards = document.querySelectorAll('.trash-stat-card');
  statCards.forEach(c => {
    const t = c.getAttribute('data-trash-tab');
    c.classList.toggle('active-stat-card', t === activeTrashTab);
  });

  // هماهنگ‌سازی دراپ‌داون فیلتر
  const typeSelect = document.getElementById('trashTypeSelectFilter');
  if (typeSelect && typeSelect.value !== activeTrashTab) {
    typeSelect.value = activeTrashTab;
  }

  // بروزرسانی عنوان دکمه‌های عملیات کلی بر اساس بخش جاری
  const tabTitles = {
    all: 'کل زباله‌دان',
    campaign: 'پویش‌ها',
    payment: 'تراکنش‌ها',
    user: 'کاربران',
    ticket: 'تیکت‌ها',
    admin: 'مدیریت'
  };
  const title = tabTitles[activeTrashTab] || 'بخش جاری';
  const emptyBtnText = document.getElementById('btnEmptyCurrentTrashText');
  if (emptyBtnText) emptyBtnText.textContent = `تخلیه ${title}`;
  const restoreAllBtnText = document.getElementById('btnRestoreAllCurrentTrashText');
  if (restoreAllBtnText) restoreAllBtnText.textContent = `بازگردانی همه ${title}`;

  await loadTrashData();
  renderTrashSection();
}
window.switchTrashTab = switchTrashTab;

function resetTrashFilters() {
  const input = document.getElementById('trashSearchInput');
  if (input) input.value = '';
  trashSearchQuery = '';
  switchTrashTab('all');
}
window.resetTrashFilters = resetTrashFilters;

function renderTrashSection() {
  // 1. بروزرسانی کارت‌های خلاصه آمار
  const elTotal = document.getElementById('statTrashTotal');
  if (elTotal) elTotal.textContent = window.CampaignDB.formatNumber(trashStats.total);
  const elCamp = document.getElementById('statTrashCampaigns');
  if (elCamp) elCamp.textContent = window.CampaignDB.formatNumber(trashStats.campaigns);
  const elPay = document.getElementById('statTrashPayments');
  if (elPay) elPay.textContent = window.CampaignDB.formatNumber(trashStats.payments);
  const elUser = document.getElementById('statTrashUsers');
  if (elUser) elUser.textContent = window.CampaignDB.formatNumber(trashStats.users);
  const elTicket = document.getElementById('statTrashTickets');
  if (elTicket) elTicket.textContent = window.CampaignDB.formatNumber(trashStats.tickets);
  const elAdmin = document.getElementById('statTrashAdmins');
  if (elAdmin) elAdmin.textContent = window.CampaignDB.formatNumber(trashStats.admins);

  // هماهنگی استایل فعال بودن کارت‌ها با تب جاری
  const statCards = document.querySelectorAll('.trash-stat-card');
  statCards.forEach(c => {
    const t = c.getAttribute('data-trash-tab');
    c.classList.toggle('active-stat-card', t === activeTrashTab);
  });

  // 2. بروزرسانی بج‌های شمارنده در تب‌ها
  const bAll = document.getElementById('badgeTrashTabAll');
  if (bAll) bAll.textContent = window.CampaignDB.formatNumber(trashStats.total);
  const bCamp = document.getElementById('badgeTrashTabCampaign');
  if (bCamp) bCamp.textContent = window.CampaignDB.formatNumber(trashStats.campaigns);
  const bPay = document.getElementById('badgeTrashTabPayment');
  if (bPay) bPay.textContent = window.CampaignDB.formatNumber(trashStats.payments);
  const bUser = document.getElementById('badgeTrashTabUser');
  if (bUser) bUser.textContent = window.CampaignDB.formatNumber(trashStats.users);
  const bTicket = document.getElementById('badgeTrashTabTicket');
  if (bTicket) bTicket.textContent = window.CampaignDB.formatNumber(trashStats.tickets);
  const bAdmin = document.getElementById('badgeTrashTabAdmin');
  if (bAdmin) bAdmin.textContent = window.CampaignDB.formatNumber(trashStats.admins);

  updateTrashSidebarBadge();

  // 3. رندر جدول آیتم‌های زباله‌دان
  const tbody = document.getElementById('trashTableBody');
  const emptyState = document.getElementById('trashEmptyState');
  const countInfo = document.getElementById('trashPaginationInfo');

  if (!tbody) return;

  if (countInfo) {
    countInfo.textContent = `نمایش ${window.CampaignDB.formatNumber(trashItemsList.length)} مورد`;
  }

  if (trashItemsList.length === 0) {
    tbody.innerHTML = '';
    if (emptyState) emptyState.style.display = 'block';
    updateTrashBatchBar();
    return;
  }

  if (emptyState) emptyState.style.display = 'none';

  const typeConfig = {
    campaign: { label: 'پویش', cssClass: 'type-campaign', icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>' },
    payment: { label: 'تراکنش', cssClass: 'type-payment', icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>' },
    user: { label: 'کاربر', cssClass: 'type-user', icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle></svg>' },
    ticket: { label: 'تیکت', cssClass: 'type-ticket', icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' },
    admin: { label: 'مدیریت', cssClass: 'type-admin', icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><circle cx="12" cy="11" r="3"/></svg>' }
  };

  tbody.innerHTML = trashItemsList.map(item => {
    const isChecked = selectedTrashIds.has(item.id);
    const conf = typeConfig[item.type] || { label: item.type || 'مورد', cssClass: '', icon: '' };
    
    // قالب‌بندی تاریخ و زمان شمسی
    let formattedDate = '-';
    if (item.deleted_at) {
      try {
        const d = new Date(item.deleted_at);
        formattedDate = d.toLocaleDateString('fa-IR') + ' ' + d.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
      } catch (e) {
        formattedDate = item.deleted_at;
      }
    }

    return `
      <tr class="${isChecked ? 'row-selected' : ''}">
        <td style="text-align: center;">
          <input type="checkbox" class="trash-row-cb" data-trash-id="${item.id}" ${isChecked ? 'checked' : ''} style="width: 17px; height: 17px; accent-color: #0f172a; cursor: pointer;" />
        </td>
        <td>
          <span class="trash-type-badge ${conf.cssClass}">
            ${conf.icon}
            <span>${conf.label}</span>
          </span>
        </td>
        <td>
          <div style="font-weight: 800; color: #0f172a; font-size: 0.92rem; margin-bottom: 3px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <span>${item.title || item.original_id}</span>
            <span class="trash-orig-id-tag">(${item.original_id})</span>
          </div>
          <div style="font-size: 0.81rem; color: #64748b; line-height: 1.5;">${item.details || '-'}</div>
        </td>
        <td>
          <div style="display: flex; align-items: center; gap: 6px;">
            <div class="trash-admin-avatar">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
            </div>
            <span style="font-size: 0.84rem; font-weight: 700; color: #334155;">${item.deleted_by || 'مدیر سیستم'}</span>
          </div>
        </td>
        <td>
          <div style="display: flex; align-items: center; gap: 5px; font-size: 0.82rem; color: #475569; direction: ltr; justify-content: flex-end;">
            <span>${formattedDate}</span>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
          </div>
        </td>
        <td style="text-align: center;">
          <div style="display: flex; gap: 6px; justify-content: center; align-items: center; flex-wrap: wrap;">
            <button type="button" class="btn-row-action btn-trash-restore" onclick="window.executeSingleRestore('${item.id}')" title="بازگردانی به سیستم">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
                <path d="M3 3v5h5"></path>
              </svg>
              <span>بازگردانی</span>
            </button>
            <button type="button" class="btn-row-action btn-trash-delete" onclick="window.openSingleDeleteModal('${item.id}')" title="حذف دائمی از سیستم">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                <line x1="10" y1="11" x2="10" y2="17"></line>
                <line x1="14" y1="11" x2="14" y2="17"></line>
              </svg>
              <span>حذف قطعی</span>
            </button>
            <button type="button" class="btn-row-action btn-trash-detail" onclick="window.openTrashItemDetailsModal('${item.id}')" title="مشاهده اطلاعات نگهداری‌شده">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="16" x2="12" y2="12"></line>
                <line x1="12" y1="8" x2="12.01" y2="8"></line>
              </svg>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // اتصال رویدادهای انتخاب سطری
  tbody.querySelectorAll('.trash-row-cb').forEach(cb => {
    cb.onchange = () => {
      const id = cb.getAttribute('data-trash-id');
      if (cb.checked) {
        selectedTrashIds.add(id);
      } else {
        selectedTrashIds.delete(id);
      }
      const row = cb.closest('tr');
      if (row) row.classList.toggle('row-selected', cb.checked);
      updateTrashBatchBar();
    };
  });

  updateTrashBatchBar();
}

function updateTrashBatchBar() {
  const bar = document.getElementById('trashBatchBar');
  const countText = document.getElementById('trashSelectedCountText');
  const headCb = document.getElementById('trashHeaderCheckbox');
  const batchAllCb = document.getElementById('trashBatchSelectAllCb');

  const count = selectedTrashIds.size;
  const totalInPage = trashItemsList.length;

  if (countText) {
    countText.textContent = `${window.CampaignDB.formatNumber(count)} مورد انتخاب شده`;
  }

  if (bar) {
    bar.style.display = count > 0 ? 'flex' : 'none';
  }

  const isAllChecked = totalInPage > 0 && count === totalInPage;
  if (headCb) headCb.checked = isAllChecked;
  if (batchAllCb) batchAllCb.checked = isAllChecked;
}

function toggleSelectAllTrash(checked) {
  if (checked) {
    trashItemsList.forEach(item => selectedTrashIds.add(item.id));
  } else {
    selectedTrashIds.clear();
  }
  const tbody = document.getElementById('trashTableBody');
  if (tbody) {
    tbody.querySelectorAll('.trash-row-cb').forEach(cb => {
      cb.checked = checked;
      const row = cb.closest('tr');
      if (row) row.classList.toggle('row-selected', checked);
    });
  }
  updateTrashBatchBar();
}

// 1. بازگردانی تکی
async function executeSingleRestore(trashId) {
  const item = trashItemsList.find(t => t.id === trashId);
  const title = item ? item.title : trashId;
  try {
    const res = await window.CampaignDB.restoreTrashItem(trashId);
    if (res && res.success) {
      showAdminToast(`«${title}» با موفقیت به بخش قبلی خود بازگردانده شد.`, 'success');
      selectedTrashIds.delete(trashId);
      await reloadAdminData();
      await loadTrashData();
      renderTrashSection();
    } else {
      showAdminToast(res?.message || 'خطا در بازگردانی مورد', 'error');
    }
  } catch (err) {
    showAdminToast(`خطا در بازگردانی: ${err.message}`, 'error');
  }
}
window.executeSingleRestore = executeSingleRestore;

// 2. حذف دائمی تکی
function openSingleDeleteModal(trashId) {
  const item = trashItemsList.find(t => String(t.id) === String(trashId));
  if (!item) return;

  pendingTrashAction = {
    type: 'delete_single',
    id: trashId,
    item
  };

  const modal = document.getElementById('modalConfirmTrashAction');
  const titleText = document.getElementById('trashConfirmModalTitleText');
  const msg = document.getElementById('trashConfirmMessage');
  const subtext = document.getElementById('trashConfirmSubtext');
  const yesBtn = document.getElementById('btnConfirmTrashActionYes');

  if (titleText) titleText.textContent = 'تایید حذف دائمی آیتم';
  if (msg) msg.textContent = `آیا از حذف کامل و دائمی «${item.title || item.original_id}» اطمینان دارید؟`;
  if (subtext) subtext.textContent = 'توجه: این مورد و کلیه داده‌ها و فایل‌های وابسته به آن به صورت کامل و غیرقابل بازگشت پاک خواهند شد و دیگر قابل بازیابی نخواهد بود.';
  if (yesBtn) {
    yesBtn.className = 'btn-quick-action danger';
    yesBtn.textContent = 'حذف دائمی و غیرقابل بازگشت';
  }

  if (modal) modal.classList.add('open');
}
window.openSingleDeleteModal = openSingleDeleteModal;

// 3. بازگردانی گروهی
function openBatchRestoreConfirm() {
  if (selectedTrashIds.size === 0) {
    showAdminToast('هیچ موردی انتخاب نشده است.', 'info');
    return;
  }

  const ids = Array.from(selectedTrashIds);
  executeBatchRestore(ids);
}

async function executeBatchRestore(ids) {
  try {
    const res = await window.CampaignDB.restoreTrashBatch(ids);
    if (res && res.success) {
      showAdminToast(res.message || `${ids.length} مورد با موفقیت بازیابی شد.`, 'success');
      selectedTrashIds.clear();
      await reloadAdminData();
      await loadTrashData();
      renderTrashSection();
    } else {
      showAdminToast(res?.message || 'خطا در بازگردانی گروهی', 'error');
    }
  } catch (err) {
    showAdminToast(`خطا در بازگردانی گروهی: ${err.message}`, 'error');
  }
}

// 4. حذف دائمی گروهی
function openBatchDeleteModal() {
  if (selectedTrashIds.size === 0) {
    showAdminToast('هیچ موردی انتخاب نشده است.', 'info');
    return;
  }

  const ids = Array.from(selectedTrashIds);
  pendingTrashAction = {
    type: 'delete_batch',
    ids
  };

  const modal = document.getElementById('modalConfirmTrashAction');
  const titleText = document.getElementById('trashConfirmModalTitleText');
  const msg = document.getElementById('trashConfirmMessage');
  const subtext = document.getElementById('trashConfirmSubtext');
  const yesBtn = document.getElementById('btnConfirmTrashActionYes');

  if (titleText) titleText.textContent = `حذف دائمی گروهی (${ids.length} مورد)`;
  if (msg) msg.textContent = `آیا از حذف کامل و دائمی این ${ids.length} مورد انتخاب‌شده اطمینان دارید؟`;
  if (subtext) subtext.textContent = 'کلیه آیتم‌های انتخاب شده و وابستگی‌های مربوطه به صورت دائمی از پایگاه داده و فایل‌ها پاکسازی می‌شوند و دیگر قابل بازیابی نخواهند بود.';
  if (yesBtn) {
    yesBtn.className = 'btn-quick-action danger';
    yesBtn.textContent = `حذف دائمی ${ids.length} مورد`;
  }

  if (modal) modal.classList.add('open');
}

// 5. تخلیه کامل بخش جاری
function openEmptyTrashModal() {
  const tabTitles = {
    all: 'کل زباله‌دان',
    campaign: 'پویش‌ها',
    payment: 'تراکنش‌ها',
    user: 'کاربران',
    ticket: 'تیکت‌ها',
    admin: 'مدیریت'
  };
  const categoryName = tabTitles[activeTrashTab] || 'بخش جاری';

  pendingTrashAction = {
    type: 'empty_category',
    category: activeTrashTab
  };

  const modal = document.getElementById('modalConfirmTrashAction');
  const titleText = document.getElementById('trashConfirmModalTitleText');
  const msg = document.getElementById('trashConfirmMessage');
  const subtext = document.getElementById('trashConfirmSubtext');
  const yesBtn = document.getElementById('btnConfirmTrashActionYes');

  if (titleText) titleText.textContent = `تخلیه کامل ${categoryName}`;
  if (msg) msg.textContent = `آیا از تخلیه کامل و پاکسازی دائمی تمام موارد بخش «${categoryName}» اطمینان دارید؟`;
  if (subtext) subtext.textContent = 'با انجام این عملیات تمام موارد موجود در این بخش از زباله‌دان و کلیه اطلاعات وابسته به آن‌ها برای همیشه محو خواهند شد.';
  if (yesBtn) {
    yesBtn.className = 'btn-quick-action danger';
    yesBtn.textContent = 'تخلیه و حذف دائمی';
  }

  if (modal) modal.classList.add('open');
}

// 6. بازگردانی همه موارد بخش جاری
async function openRestoreAllTrashConfirm() {
  const tabTitles = {
    all: 'کل زباله‌دان',
    campaign: 'پویش‌ها',
    payment: 'تراکنش‌ها',
    user: 'کاربران',
    ticket: 'تیکت‌ها',
    admin: 'مدیریت'
  };
  const categoryName = tabTitles[activeTrashTab] || 'بخش جاری';

  try {
    const res = await window.CampaignDB.restoreAllTrash(activeTrashTab);
    if (res && res.success) {
      showAdminToast(res.message || `تمام موارد «${categoryName}» با موفقیت بازگردانی شدند.`, 'success');
      selectedTrashIds.clear();
      await reloadAdminData();
      await loadTrashData();
      renderTrashSection();
    } else {
      showAdminToast(res?.message || 'خطا در بازگردانی کلی', 'error');
    }
  } catch (err) {
    showAdminToast(`خطا در بازگردانی: ${err.message}`, 'error');
  }
}

// 7. مشاهده جزئیات آیتم زباله‌دان
function openTrashItemDetailsModal(trashId) {
  const item = trashItemsList.find(t => t.id === trashId);
  if (!item) return;

  currentViewingTrashId = trashId;

  const modal = document.getElementById('modalTrashItemDetails');
  const titleEl = document.getElementById('trashDetailModalTitle');
  const idEl = document.getElementById('trashDetailModalId');
  const summaryBox = document.getElementById('trashDetailSummaryBox');
  const jsonPre = document.getElementById('trashDetailJsonPre');

  const typeNames = {
    campaign: 'پویش',
    payment: 'تراکنش / واریزی',
    user: 'کاربر',
    ticket: 'تیکت پشتیبانی',
    admin: 'مدیریت'
  };

  if (titleEl) titleEl.textContent = `جزئیات آیتم: ${item.title || item.original_id}`;
  if (idEl) idEl.textContent = `شناسه اصلی: ${item.original_id} | شناسه زباله‌دان: ${item.id}`;

  let formattedDate = '-';
  if (item.deleted_at) {
    try {
      const d = new Date(item.deleted_at);
      formattedDate = d.toLocaleDateString('fa-IR') + ' ' + d.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      formattedDate = item.deleted_at;
    }
  }

  if (summaryBox) {
    summaryBox.innerHTML = `
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; font-size: 0.86rem;">
        <div>
          <span style="color: #64748b;">بخش سیستم:</span>
          <strong style="color: #0f172a; margin-right: 6px;">${typeNames[item.type] || item.type}</strong>
        </div>
        <div>
          <span style="color: #64748b;">عنوان آیتم:</span>
          <strong style="color: #0f172a; margin-right: 6px;">${item.title || '-'}</strong>
        </div>
        <div>
          <span style="color: #64748b;">حذف شده توسط:</span>
          <strong style="color: #0f172a; margin-right: 6px;">${item.deleted_by || 'مدیر سیستم'}</strong>
        </div>
        <div>
          <span style="color: #64748b;">زمان انتقال به زباله‌دان:</span>
          <strong style="color: #0f172a; margin-right: 6px; direction: ltr; display: inline-block;">${formattedDate}</strong>
        </div>
      </div>
      <div style="margin-top: 10px; padding-top: 10px; border-top: 1px dashed #cbd5e1; font-size: 0.84rem; color: #334155;">
        <span style="color: #64748b;">خلاصه مشخصات:</span> ${item.details || '-'}
      </div>
    `;
  }

  // نمایش ساختاریافته و بصری اطلاعات نگهداری‌شده بر اساس نوع آیتم
  const structuredBox = document.getElementById('trashDetailStructuredBox');
  if (structuredBox) {
    const p = item.payload || {};
    let contentHtml = '';

    if (item.type === 'campaign') {
      contentHtml = `
        <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px;">
          <div style="display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap;">
            ${p.image_url ? `<img src="${escapeHtml(p.image_url)}" alt="پوستر" style="width: 140px; height: 80px; object-fit: cover; border-radius: 8px; border: 1px solid #cbd5e1;" />` : ''}
            <div style="flex: 1;">
              <h4 style="font-size: 1rem; font-weight: 800; color: #0f172a; margin-bottom: 6px;">${escapeHtml(p.title || item.title)}</h4>
              <p style="font-size: 0.84rem; color: #475569; line-height: 1.6; margin-bottom: 10px;">${escapeHtml(p.description || 'بدون توضیحات')}</p>
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; font-size: 0.82rem;">
                <div><strong>هدف مالی:</strong> ${(Number(p.target_amount) || 0).toLocaleString('fa-IR')} تومان</div>
                <div><strong>قیمت هر سهم:</strong> ${(Number(p.share_price) || 0).toLocaleString('fa-IR')} تومان</div>
                <div><strong>کل سهم‌ها:</strong> ${(Number(p.total_shares) || 0).toLocaleString('fa-IR')}</div>
                <div><strong>وضعیت پویش:</strong> <span class="status-badge ${p.status === 'active' ? 'success' : 'pending'}">${p.status === 'active' ? 'فعال' : p.status}</span></div>
              </div>
            </div>
          </div>
        </div>
      `;
    } else if (item.type === 'payment') {
      contentHtml = `
        <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px;">
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; font-size: 0.85rem;">
            <div><span style="color: #64748b;">نام واریزکننده:</span> <strong style="color: #0f172a;">${escapeHtml(p.donor_name || p.payer_name || 'ناشناس')}</strong></div>
            <div><span style="color: #64748b;">شماره تماس:</span> <strong style="direction: ltr; display: inline-block;">${window.CampaignDB.toPersianDigits(p.phone || '-')}</strong></div>
            <div><span style="color: #64748b;">مبلغ پرداختی:</span> <strong style="color: #059669; font-size: 1rem;">${(Number(p.amount) || 0).toLocaleString('fa-IR')} تومان</strong></div>
            <div><span style="color: #64748b;">کد رهگیری:</span> <strong style="color: #0284c7; font-family: monospace;">${escapeHtml(p.tracking_code || p.id || '-')}</strong></div>
            <div><span style="color: #64748b;">تعداد سهم:</span> <strong>${window.CampaignDB.formatNumber(p.shares || 1)}</strong></div>
            <div><span style="color: #64748b;">نوع حامی:</span> <strong>${p.is_anonymous ? 'حمایت ناشناس' : 'حامی مشخص'}</strong></div>
            <div><span style="color: #64748b;">وضعیت تراکنش:</span> <span class="status-badge ${p.status === 'successful' || p.status === 'success' ? 'success' : 'failed'}">${p.status === 'successful' || p.status === 'success' ? 'موفق' : p.status}</span></div>
          </div>
        </div>
      `;
    } else if (item.type === 'user') {
      contentHtml = `
        <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px;">
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; font-size: 0.85rem;">
            <div><span style="color: #64748b;">نام کاربر:</span> <strong style="color: #0f172a;">${escapeHtml(p.name || item.title)}</strong></div>
            <div><span style="color: #64748b;">شماره همراه:</span> <strong style="direction: ltr; display: inline-block;">${window.CampaignDB.toPersianDigits(p.phone || '-')}</strong></div>
            <div><span style="color: #64748b;">مجموع واریزی‌ها:</span> <strong style="color: #059669;">${(Number(p.total_amount) || 0).toLocaleString('fa-IR')} تومان</strong></div>
            <div><span style="color: #64748b;">تعداد دفعات مشارکت:</span> <strong>${window.CampaignDB.formatNumber(p.payments_count || 0)} بار</strong></div>
          </div>
        </div>
      `;
    } else if (item.type === 'ticket') {
      const ticket = p.ticket || p;
      const msgs = Array.isArray(p.messages) ? p.messages : [];
      contentHtml = `
        <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px;">
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; font-size: 0.84rem; margin-bottom: 12px;">
            <div><span style="color: #64748b;">موضوع پیام:</span> <strong style="color: #0f172a;">${escapeHtml(ticket.subject || '-')}</strong></div>
            <div><span style="color: #64748b;">فرستنده:</span> <strong>${escapeHtml(ticket.name || 'ناشناس')}</strong></div>
            <div><span style="color: #64748b;">شماره تماس:</span> <strong style="direction: ltr; display: inline-block;">${window.CampaignDB.toPersianDigits(ticket.phone || '-')}</strong></div>
            <div><span style="color: #64748b;">کد پیگیری:</span> <strong style="font-family: monospace;">${escapeHtml(ticket.tracking_code || '-')}</strong></div>
          </div>
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; margin-bottom: 10px; font-size: 0.85rem; line-height: 1.6;">
            <strong>متن پیام اولیه:</strong>
            <p style="margin-top: 4px; color: #334155;">${escapeHtml(ticket.description || 'بدون متن')}</p>
          </div>
          ${msgs.length > 0 ? `
            <div style="font-size: 0.82rem; font-weight: 800; color: #475569; margin-bottom: 6px;">تاریخچه گفتگو و پاسخ‌ها (${msgs.length} پیام):</div>
            <div style="display: flex; flex-direction: column; gap: 6px; max-height: 150px; overflow-y: auto;">
              ${msgs.map(m => `
                <div style="padding: 8px 10px; border-radius: 8px; background: ${m.sender_type === 'admin' ? '#eff6ff' : '#f1f5f9'}; border: 1px solid #e2e8f0; font-size: 0.8rem;">
                  <span style="font-weight: 700; color: ${m.sender_type === 'admin' ? '#1d4ed8' : '#334155'};">${m.sender_type === 'admin' ? 'پاسخ مدیر' : 'کاربر'}:</span> ${escapeHtml(m.message || '')}
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>
      `;
    } else if (item.type === 'admin') {
      contentHtml = `
        <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px;">
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; font-size: 0.85rem; margin-bottom: 12px;">
            <div><span style="color: #64748b;">نام مدیر:</span> <strong style="color: #0f172a;">${escapeHtml(p.name || item.title)}</strong></div>
            <div><span style="color: #64748b;">ایمیل / نام کاربری:</span> <strong style="direction: ltr; display: inline-block;">${escapeHtml(p.email || '-')}</strong></div>
            <div><span style="color: #64748b;">نقش:</span> <strong>${p.is_super_admin ? 'مدیر ارشد (دسترسی کامل)' : 'مدیر بخش'}</strong></div>
            <div><span style="color: #64748b;">وضعیت پیشین:</span> <strong>${p.is_active !== false ? 'فعال' : 'غیرفعال'}</strong></div>
          </div>
          <div style="font-size: 0.82rem;">
            <span style="color: #64748b;">دسترسی‌های فعال:</span>
            <div style="display: flex; gap: 4px; flex-wrap: wrap; margin-top: 6px;">
              ${(p.permissions || []).map(perm => `<span style="background: #f1f5f9; color: #475569; padding: 2px 7px; border-radius: 6px; font-size: 0.74rem;">${escapeHtml(perm)}</span>`).join('')}
            </div>
          </div>
        </div>
      `;
    }

    structuredBox.innerHTML = contentHtml;
  }

  if (jsonPre) {
    jsonPre.textContent = JSON.stringify(item.payload || {}, null, 2);
  }

  if (modal) modal.classList.add('open');
}
window.openTrashItemDetailsModal = openTrashItemDetailsModal;

function setupTrashEventListeners() {
  const searchInput = document.getElementById('trashSearchInput');
  if (searchInput && !searchInput._bound) {
    searchInput._bound = true;
    let debounceTimer = null;
    searchInput.oninput = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        trashSearchQuery = searchInput.value;
        loadTrashData().then(() => renderTrashSection());
      }, 300);
    };
  }

  const typeFilter = document.getElementById('trashTypeSelectFilter');
  if (typeFilter && !typeFilter._bound) {
    typeFilter._bound = true;
    typeFilter.onchange = () => {
      switchTrashTab(typeFilter.value);
    };
  }

  const btnRefresh = document.getElementById('btnRefreshTrash');
  if (btnRefresh && !btnRefresh._bound) {
    btnRefresh._bound = true;
    btnRefresh.onclick = async () => {
      await loadTrashData();
      renderTrashSection();
      showAdminToast('زباله‌دان بروزرسانی شد.', 'info');
    };
  }

  const btnEmpty = document.getElementById('btnEmptyCurrentTrash');
  if (btnEmpty && !btnEmpty._bound) {
    btnEmpty._bound = true;
    btnEmpty.onclick = () => openEmptyTrashModal();
  }

  const btnRestoreAll = document.getElementById('btnRestoreAllCurrentTrash');
  if (btnRestoreAll && !btnRestoreAll._bound) {
    btnRestoreAll._bound = true;
    btnRestoreAll.onclick = () => openRestoreAllTrashConfirm();
  }

  const headCb = document.getElementById('trashHeaderCheckbox');
  if (headCb && !headCb._bound) {
    headCb._bound = true;
    headCb.onchange = () => toggleSelectAllTrash(headCb.checked);
  }

  const batchAllCb = document.getElementById('trashBatchSelectAllCb');
  if (batchAllCb && !batchAllCb._bound) {
    batchAllCb._bound = true;
    batchAllCb.onchange = () => toggleSelectAllTrash(batchAllCb.checked);
  }

  const btnBatchRestore = document.getElementById('btnTrashBatchRestore');
  if (btnBatchRestore && !btnBatchRestore._bound) {
    btnBatchRestore._bound = true;
    btnBatchRestore.onclick = () => openBatchRestoreConfirm();
  }

  const btnBatchDelete = document.getElementById('btnTrashBatchPermanentDelete');
  if (btnBatchDelete && !btnBatchDelete._bound) {
    btnBatchDelete._bound = true;
    btnBatchDelete.onclick = () => openBatchDeleteModal();
  }

  // دکمه تایید مودال عملیات حذف قطعی
  const confirmYesBtn = document.getElementById('btnConfirmTrashActionYes');
  if (confirmYesBtn && !confirmYesBtn._bound) {
    confirmYesBtn._bound = true;
    confirmYesBtn.onclick = async () => {
      const modal = document.getElementById('modalConfirmTrashAction');
      if (modal) modal.classList.remove('open');

      if (!pendingTrashAction) return;

      if (pendingTrashAction.type === 'delete_single') {
        const id = pendingTrashAction.id;
        try {
          const res = await window.CampaignDB.deleteTrashItemPermanent(id);
          if (res && res.success) {
            showAdminToast(res.message || 'مورد با موفقیت به صورت کامل و دائمی از سیستم حذف شد.', 'success');
            selectedTrashIds.delete(id);
            await loadTrashData();
            renderTrashSection();
          } else {
            showAdminToast(res?.message || 'خطا در حذف دائمی مورد', 'error');
          }
        } catch (err) {
          showAdminToast(`خطا در حذف دائمی: ${err.message}`, 'error');
        }
      } else if (pendingTrashAction.type === 'delete_batch') {
        const ids = pendingTrashAction.ids;
        try {
          const res = await window.CampaignDB.deleteTrashBatchPermanent(ids);
          if (res && res.success) {
            showAdminToast(res.message || `${ids.length} مورد به صورت کامل و دائمی از سیستم حذف شدند.`, 'success');
            selectedTrashIds.clear();
            await loadTrashData();
            renderTrashSection();
          } else {
            showAdminToast(res?.message || 'خطا در حذف دائمی گروهی', 'error');
          }
        } catch (err) {
          showAdminToast(`خطا در حذف دائمی گروهی: ${err.message}`, 'error');
        }
      } else if (pendingTrashAction.type === 'empty_category') {
        const cat = pendingTrashAction.category;
        try {
          const res = await window.CampaignDB.emptyTrash(cat);
          if (res && res.success) {
            showAdminToast(res.message || 'زباله‌دان این بخش به صورت کامل تخلیه شد.', 'success');
            selectedTrashIds.clear();
            await loadTrashData();
            renderTrashSection();
          } else {
            showAdminToast(res?.message || 'خطا در تخلیه زباله‌دان', 'error');
          }
        } catch (err) {
          showAdminToast(`خطا در تخلیه زباله‌دان: ${err.message}`, 'error');
        }
      }

      pendingTrashAction = null;
    };
  }

  // مودال مشاهده جزئیات: دکمه بازگردانی و حذف قطعی
  const btnDetailRestore = document.getElementById('btnDetailModalRestore');
  if (btnDetailRestore && !btnDetailRestore._bound) {
    btnDetailRestore._bound = true;
    btnDetailRestore.onclick = async () => {
      const modal = document.getElementById('modalTrashItemDetails');
      if (modal) modal.classList.remove('open');
      if (currentViewingTrashId) {
        await executeSingleRestore(currentViewingTrashId);
      }
    };
  }

  const btnDetailDelete = document.getElementById('btnDetailModalDeletePermanent');
  if (btnDetailDelete && !btnDetailDelete._bound) {
    btnDetailDelete._bound = true;
    btnDetailDelete.onclick = () => {
      const modal = document.getElementById('modalTrashItemDetails');
      if (modal) modal.classList.remove('open');
      if (currentViewingTrashId) {
        openSingleDeleteModal(currentViewingTrashId);
      }
    };
  }
}
window.setupTrashEventListeners = setupTrashEventListeners;
window.openBatchDeleteModal = openBatchDeleteModal;
window.openBatchRestoreConfirm = openBatchRestoreConfirm;
window.openEmptyTrashModal = openEmptyTrashModal;
window.openRestoreAllTrashConfirm = openRestoreAllTrashConfirm;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initAdminPanel();
  });
} else {
  initAdminPanel();
}
