import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, signOut, deleteUser, updatePassword, EmailAuthProvider, reauthenticateWithCredential } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, deleteDoc, onSnapshot, serverTimestamp, query, orderBy, getDoc } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import { getStorage, ref, uploadBytesResumable, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-storage.js";

/*
 * غمزونة Cloud
 * 1) انسخ firebase-config.example.js إلى firebase-config.js واملأ بيانات مشروعك.
 * 2) لا تضع مفاتيح خدمة أو أسرار Admin SDK داخل الواجهة.
 * 3) قواعد Firestore/Storage هي خط الدفاع الأساسي؛ لا تعتمد على تحقق الواجهة وحده.
 */
import { firebaseConfig } from "../../firebase-config.js";

const APP_LIMIT_BYTES = 5 * 1024 ** 3; // حد تطبيقي 5 GiB، وليس حصة Firebase مجانية.
const FILE_LIMIT_BYTES = 512 * 1024 ** 2;
const $ = (selector) => document.querySelector(selector);
const views = ["welcome", "signup", "login", "dashboard"];
let auth, db, storage, currentUser = null, files = [], unsubscribeFiles = null;
let pendingPassword = null;
const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 بايت";
  const units = ["بايت", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return (bytes / Math.pow(1024, index)).toLocaleString("ar-EG", {maximumFractionDigits: index ? 2 : 0}) + " " + units[index];
};
const formatDate = (date) => {
  if (!date) return "—";
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("ar-EG", {dateStyle:"medium", timeStyle:"short"}).format(d);
};
function toast(message, type = "info") {
  const item = document.createElement("div");
  item.className = "toast " + type;
  const icon = document.createElement("i");
  icon.className = "fa-solid " + (type === "success" ? "fa-circle-check" : type === "error" ? "fa-circle-exclamation" : "fa-circle-info");
  const text = document.createElement("span");
  text.textContent = message;
  item.append(icon, text);
  $("#toast-region").append(item);
  window.setTimeout(() => item.remove(), 5500);
}
function showView(view) {
  views.forEach(name => {
    const node = document.getElementById(name + "-view");
    if (node) node.classList.toggle("hidden", name !== view);
  });
  $("#loading-screen").classList.add("hidden");
}
function setBusy(button, busy, label = "جارٍ التنفيذ...") {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<span class="spinner" aria-hidden="true"></span> ' + label;
  } else {
    button.disabled = false;
    if (button.dataset.originalText) button.innerHTML = button.dataset.originalText;
    delete button.dataset.originalText;
  }
}
function friendlyError(error) {
  const code = error?.code || "";
  const messages = {
    "auth/email-already-in-use":"هذا البريد مسجّل بالفعل. جرّب تسجيل الدخول.",
    "auth/invalid-email":"صيغة البريد الإلكتروني غير صحيحة.",
    "auth/weak-password":"كلمة المرور لا تحقق متطلبات القوة.",
    "auth/invalid-credential":"البريد الإلكتروني أو كلمة المرور غير صحيحة.",
    "auth/user-not-found":"لا يوجد حساب بهذه البيانات.",
    "auth/wrong-password":"البريد الإلكتروني أو كلمة المرور غير صحيحة.",
    "auth/too-many-requests":"محاولات كثيرة. انتظر قليلًا ثم أعد المحاولة.",
    "auth/network-request-failed":"تعذر الاتصال. تحقق من الإنترنت وحاول مجددًا.",
    "auth/requires-recent-login":"لأمان حسابك، سجّل الدخول مجددًا ثم أعد المحاولة.",
    "storage/unauthorized":"رفضت قواعد التخزين هذه العملية. تحقق من إعدادات Firebase.",
    "storage/quota-exceeded":"تجاوز المشروع حصة التخزين المتاحة.",
    "storage/canceled":"تم إلغاء رفع الملف.",
    "permission-denied":"رفضت قواعد قاعدة البيانات هذه العملية."
  };
  return messages[code] || "حدث خطأ. " + (error?.message || "تحقق من إعدادات Firebase وحاول مجددًا.");
}
function generateStrongPassword(length = 20) {
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#$%^&*()-_=+?"];
  const all = sets.join("");
  const randomIndex = max => {
    const range = new Uint32Array(1);
    crypto.getRandomValues(range);
    return range[0] % max;
  };
  const chars = sets.map(set => set[randomIndex(set.length)]);
  while (chars.length < length) chars.push(all[randomIndex(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
function safeEmail(email) {
  return typeof email === "string" && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function userFilesCollection(user) {
  return collection(db, "users", user.uid, "files");
}
function updateStats() {
  const used = files.reduce((sum, file) => sum + (Number(file.size) || 0), 0);
  const remaining = Math.max(0, APP_LIMIT_BYTES - used);
  const percent = Math.min(100, used / APP_LIMIT_BYTES * 100);
  $("#used-storage").textContent = formatBytes(used);
  $("#remaining-storage").textContent = formatBytes(remaining);
  $("#file-count").textContent = files.length.toLocaleString("ar-EG");
  $("#last-sync").textContent = files.length ? formatDate(new Date()) : "—";
  $("#storage-percent").textContent = percent.toLocaleString("ar-EG", {maximumFractionDigits:1}) + "%";
  $("#storage-progress").style.width = percent + "%";
  $("#storage-used-label").textContent = formatBytes(used) + " مستخدم";
  $("#files-count-badge").textContent = files.length.toLocaleString("ar-EG");
}
function fileIcon(name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (["jpg","jpeg","png","gif","webp","svg","heic"].includes(ext)) return ["fa-file-image","#e9f7ef","#2b9b68"];
  if (["mp4","mov","avi","mkv","webm"].includes(ext)) return ["fa-file-video","#fff1e6","#d78132"];
  if (["pdf"].includes(ext)) return ["fa-file-pdf","#ffebee","#d5485c"];
  if (["doc","docx","odt","txt","rtf"].includes(ext)) return ["fa-file-lines","#e9f3ff","#3985d0"];
  if (["zip","rar","7z","tar","gz"].includes(ext)) return ["fa-file-zipper","#fff7df","#bd902a"];
  if (["mp3","wav","ogg","m4a"].includes(ext)) return ["fa-file-audio","#f5eaff","#9456c4"];
  return ["fa-file","#f0edff","#7966d4"];
}
function renderFiles() {
  const tbody = $("#files-tbody");
  const term = $("#file-search").value.trim().toLocaleLowerCase();
  const shown = files.filter(file => (file.name || "").toLocaleLowerCase().includes(term));
  tbody.replaceChildren();
  $("#empty-files").classList.toggle("hidden", shown.length !== 0);
  $(".table-wrap").classList.toggle("hidden", shown.length === 0);
  if (!shown.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 4; cell.className = "empty-cell";
    cell.textContent = term ? "لا توجد ملفات تطابق بحثك." : "لا توجد ملفات بعد.";
    row.append(cell); tbody.append(row);
  }
  shown.forEach(file => {
    const row = document.createElement("tr");
    const nameCell = document.createElement("td");
    const wrapper = document.createElement("div"); wrapper.className = "file-cell";
    const [iconName, bg, color] = fileIcon(file.name || "");
    const icon = document.createElement("span"); icon.className = "file-icon"; icon.style.background = bg; icon.style.color = color;
    const i = document.createElement("i"); i.className = "fa-solid " + iconName; icon.append(i);
    const nameWrap = document.createElement("div");
    const name = document.createElement("div"); name.className = "file-name"; name.textContent = file.name || "ملف دون اسم"; name.title = file.name || "";
    const sub = document.createElement("div"); sub.className = "file-sub"; sub.textContent = file.contentType || "ملف";
    nameWrap.append(name, sub); wrapper.append(icon, nameWrap); nameCell.append(wrapper);
    const sizeCell = document.createElement("td"); sizeCell.textContent = formatBytes(Number(file.size) || 0);
    const dateCell = document.createElement("td"); dateCell.textContent = formatDate(file.createdAt?.toDate ? file.createdAt.toDate() : file.createdAt);
    const actionCell = document.createElement("td"); const actions = document.createElement("div"); actions.className = "file-actions";
    const download = document.createElement("button"); download.type = "button"; download.title = "تنزيل الملف"; download.setAttribute("aria-label","تنزيل " + (file.name || "الملف")); download.innerHTML = '<i class="fa-solid fa-download"></i>';
    download.addEventListener("click", () => downloadFile(file, download));
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "delete-file"; remove.title = "حذف الملف"; remove.setAttribute("aria-label","حذف " + (file.name || "الملف")); remove.innerHTML = '<i class="fa-solid fa-trash"></i>';
    remove.addEventListener("click", () => removeFile(file, remove));
    actions.append(download, remove); actionCell.append(actions); row.append(nameCell, sizeCell, dateCell, actionCell); tbody.append(row);
  });
  updateStats();
}
function watchFiles(user) {
  if (unsubscribeFiles) unsubscribeFiles();
  files = []; renderFiles();
  const q = query(userFilesCollection(user), orderBy("createdAt", "desc"));
  unsubscribeFiles = onSnapshot(q, snapshot => {
    files = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    renderFiles();
    $("#last-sync").textContent = formatDate(new Date());
  }, error => {
    console.error("File list subscription failed:", error.code || "unknown");
    toast(friendlyError(error), "error");
  });
}
async function uploadOne(file) {
  if (!currentUser) throw new Error("يجب تسجيل الدخول أولًا.");
  if (!(file instanceof File) || file.size <= 0) throw new Error("الملف فارغ أو غير صالح.");
  if (file.size > FILE_LIMIT_BYTES) throw new Error("الحد الأقصى لحجم الملف الواحد هو 512 MB: " + file.name);
  const used = files.reduce((sum, item) => sum + (Number(item.size) || 0), 0);
  if (used + file.size > APP_LIMIT_BYTES) throw new Error("سيؤدي هذا الملف إلى تجاوز حد الحساب التطبيقي البالغ 5 GB.");
  const id = crypto.randomUUID();
  const safeName = file.name.replace(/[\\/]/g, "_").slice(0, 240) || "file";
  const storagePath = "users/" + currentUser.uid + "/" + id + "/" + safeName;
  const itemRef = ref(storage, storagePath);
  const queue = $("#upload-queue");
  queue.classList.remove("hidden");
  const item = document.createElement("div"); item.className = "upload-item";
  const head = document.createElement("div"); head.className = "upload-item-head";
  const label = document.createElement("span"); label.textContent = file.name;
  const percentLabel = document.createElement("span"); percentLabel.textContent = "0%";
  head.append(label, percentLabel);
  const track = document.createElement("div"); track.className = "progress-track";
  const bar = document.createElement("div"); bar.className = "progress-fill"; bar.style.width = "0%"; track.append(bar);
  item.append(head, track); queue.append(item);
  try {
    await new Promise((resolve, reject) => {
      const task = uploadBytesResumable(itemRef, file, { contentType: file.type || "application/octet-stream", customMetadata: { ownerUid: currentUser.uid } });
      task.on("state_changed", snapshot => {
        const percent = Math.round(snapshot.bytesTransferred / snapshot.totalBytes * 100);
        bar.style.width = percent + "%"; percentLabel.textContent = percent + "%";
      }, reject, resolve);
    });
    await setDoc(doc(db, "users", currentUser.uid, "files", id), {
      name: safeName, size: file.size, contentType: file.type || "application/octet-stream",
      storagePath, createdAt: serverTimestamp()
    });
    toast("تم رفع " + file.name + " بنجاح.", "success");
  } catch (error) {
    try { await deleteObject(itemRef); } catch (_) {}
    throw error;
  } finally {
    window.setTimeout(() => { item.remove(); if (!queue.children.length) queue.classList.add("hidden"); }, 1800);
  }
}
async function handleFiles(fileList) {
  const list = Array.from(fileList || []);
  if (!list.length) return;
  for (const file of list) {
    try { await uploadOne(file); }
    catch (error) { toast(file.name + ": " + (error.message?.startsWith("ال") || error.message?.startsWith("سيؤدي") ? error.message : friendlyError(error)), "error"); }
  }
  $("#file-picker").value = "";
}
async function downloadFile(file, button) {
  try {
    button.disabled = true;
    const url = await getDownloadURL(ref(storage, file.storagePath));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = file.name || "download"; anchor.rel = "noopener noreferrer";
    document.body.append(anchor); anchor.click(); anchor.remove();
  } catch (error) { toast(friendlyError(error), "error"); }
  finally { button.disabled = false; }
}
async function removeFile(file, button) {
  if (!confirm('هل أنت متأكد من حذف الملف "' + (file.name || "بدون اسم") + '" نهائيًا؟')) return;
  button.disabled = true;
  try {
    await deleteObject(ref(storage, file.storagePath));
    await deleteDoc(doc(db, "users", currentUser.uid, "files", file.id));
    toast("تم حذف الملف.", "success");
  } catch (error) { toast(friendlyError(error), "error"); }
  finally { button.disabled = false; }
}
function updateConnection() {
  const online = navigator.onLine;
  $("#connection-status").classList.toggle("offline", !online);
  $("#connection-status").innerHTML = online ? '<i class="fa-solid fa-circle"></i> متصل' : '<i class="fa-solid fa-circle"></i> غير متصل';
}
async function signup(event) {
  event.preventDefault();
  const button = $("#signup-submit"), email = $("#signup-email").value.trim();
  if (!safeEmail(email)) return toast("أدخل بريدًا إلكترونيًا صحيحًا.", "error");
  const password = generateStrongPassword(20);
  pendingPassword = password; // Keep the one-time password visible while auth state changes.
  setBusy(button, true, "جارٍ إنشاء الحساب...");
  try {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    $("#generated-password").value = password;
    $("#generated-password-box").classList.remove("hidden");
    $("#signup-form").classList.add("hidden");
    showView("signup");
    toast("تم إنشاء الحساب. انسخ كلمة المرور واحفظها قبل المتابعة.", "success");
    try {
      await setDoc(doc(db, "users", credential.user.uid), { email: credential.user.email, createdAt: serverTimestamp() });
    } catch (profileError) {
      console.error("Profile initialization failed:", profileError.code || "unknown");
      toast("تم إنشاء حساب المصادقة، لكن تعذرت تهيئة بيانات الملف الشخصي. راجع قواعد Firestore.", "error");
    }
  } catch (error) {
    pendingPassword = null;
    toast(friendlyError(error), "error");
  } finally { setBusy(button, false); }
}
async function login(event) {
  event.preventDefault();
  const button = $("#login-submit"), email = $("#login-email").value.trim(), password = $("#login-password").value;
  if (!safeEmail(email) || !password) return toast("أدخل البريد وكلمة المرور.", "error");
  setBusy(button, true, "جارٍ تسجيل الدخول...");
  try { await signInWithEmailAndPassword(auth, email, password); toast("تم تسجيل الدخول بنجاح.", "success"); }
  catch (error) { toast(friendlyError(error), "error"); }
  finally { setBusy(button, false); }
}
async function resetPassword() {
  const email = ($("#login-email").value || $("#signup-email").value || currentUser?.email || "").trim();
  if (!safeEmail(email)) return toast("اكتب بريدك الإلكتروني أولًا.", "error");
  try { await sendPasswordResetEmail(auth, email); toast("إذا كان البريد مسجلًا، فسيصلك رابط إعادة تعيين كلمة المرور.", "success"); }
  catch (error) { toast(friendlyError(error), "error"); }
}
async function logout() {
  try { await signOut(auth); toast("تم تسجيل الخروج.", "success"); }
  catch (error) { toast(friendlyError(error), "error"); }
}
function openSettings() {
  $("#settings-email").textContent = currentUser?.email || "";
  $("#settings-modal").classList.remove("hidden");
}
function closeSettings() { $("#settings-modal").classList.add("hidden"); }
function initEvents() {
  document.querySelectorAll("[data-view]").forEach(button => button.addEventListener("click", () => {
    $("#signup-form").classList.remove("hidden");
    $("#generated-password-box").classList.add("hidden");
    showView(button.dataset.view);
  }));
  $("#signup-form").addEventListener("submit", signup);
  $("#login-form").addEventListener("submit", login);
  $("#forgot-password").addEventListener("click", resetPassword);
  $("#settings-reset-password").addEventListener("click", resetPassword);
  $("#logout-button").addEventListener("click", logout);
  $("#file-picker").addEventListener("change", event => handleFiles(event.target.files));
  $("#file-search").addEventListener("input", renderFiles);
  $("#drop-zone").addEventListener("click", () => $("#file-picker").click());
  $("#drop-zone").addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); $("#file-picker").click(); } });
  ["dragenter","dragover"].forEach(name => $("#drop-zone").addEventListener(name, event => { event.preventDefault(); $("#drop-zone").classList.add("dragover"); }));
  ["dragleave","drop"].forEach(name => $("#drop-zone").addEventListener(name, event => { event.preventDefault(); $("#drop-zone").classList.remove("dragover"); }));
  $("#drop-zone").addEventListener("drop", event => handleFiles(event.dataTransfer.files));
  $("#menu-toggle").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
  document.querySelectorAll("[data-scroll]").forEach(button => button.addEventListener("click", () => { document.getElementById(button.dataset.scroll).scrollIntoView({behavior:"smooth"}); $("#sidebar").classList.remove("open"); }));
  document.querySelectorAll("[data-open-settings]").forEach(button => button.addEventListener("click", openSettings));
  document.querySelectorAll("[data-close-modal]").forEach(button => button.addEventListener("click", closeSettings));
  $("#settings-modal").addEventListener("click", event => { if (event.target === $("#settings-modal")) closeSettings(); });
  document.querySelectorAll(".toggle-password").forEach(button => button.addEventListener("click", () => {
    const input = document.getElementById(button.dataset.target); input.type = input.type === "password" ? "text" : "password";
    button.innerHTML = input.type === "password" ? '<i class="fa-regular fa-eye"></i>' : '<i class="fa-regular fa-eye-slash"></i>';
  }));
  $("#copy-password").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("#generated-password").value); toast("تم نسخ كلمة المرور.", "success"); }
    catch (_) { $("#generated-password").select(); toast("تعذر النسخ التلقائي؛ حدّد كلمة المرور وانسخها يدويًا.", "info"); }
  });
  $("#continue-after-signup").addEventListener("click", () => {
    pendingPassword = null;
    $("#generated-password").value = "";
    $("#generated-password-box").classList.add("hidden");
    toast("احفظ كلمة المرور في مكان آمن. يمكنك الآن استخدام حسابك.", "info");
    if (currentUser) { showView("dashboard"); watchFiles(currentUser); }
  });
  $("#delete-account-button").addEventListener("click", () => toast("حذف الحساب مع تنظيف الملفات يحتاج وظيفة خادمية آمنة، لذلك الخيار غير متاح حاليًا.", "info"));
  window.addEventListener("online", updateConnection);
  window.addEventListener("offline", updateConnection);
}
function start() {
  if (!firebaseConfig || !firebaseConfig.apiKey || firebaseConfig.apiKey === "YOUR_API_KEY") {
    $("#loading-screen").innerHTML = '<div class="brand-mark"><i class="fa-solid fa-cloud"></i></div><h2>خطوة إعداد واحدة متبقية</h2><p>أضف بيانات مشروع Firebase إلى firebase-config.js لبدء استخدام غمزونة Cloud.</p><p><a href="https://console.firebase.google.com/" target="_blank" rel="noopener noreferrer">فتح Firebase Console</a></p><p class="tiny-note">راجع README.md لمعرفة خطوات الإعداد وقواعد الأمان قبل الاستخدام.</p>';
    return;
  }
  try {
    const app = initializeApp(firebaseConfig);
    auth = getAuth(app); db = getFirestore(app); storage = getStorage(app);
    initEvents(); updateConnection();
    onAuthStateChanged(auth, user => {
      currentUser = user;
      if (user && pendingPassword) {
        showView("signup");
        return;
      }
      if (user) {
        $("#user-email-display").textContent = user.email || "حساب غمزونة";
        $("#user-avatar").textContent = (user.email || "غ").charAt(0).toLocaleUpperCase("ar-EG");
        showView("dashboard"); watchFiles(user);
      } else {
        if (unsubscribeFiles) unsubscribeFiles(); unsubscribeFiles = null; files = []; pendingPassword = null;
        $("#login-password").value = "";
        showView("welcome");
      }
    });
  } catch (error) {
    console.error("Firebase initialization failed:", error.code || "unknown");
    $("#loading-screen").innerHTML = '<div class="brand-mark"><i class="fa-solid fa-triangle-exclamation"></i></div><h2>تعذر بدء التطبيق</h2><p>تحقق من إعدادات Firebase في firebase-config.js ثم أعد تحميل الصفحة.</p>';
  }
}
start();