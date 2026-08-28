/* ============================================================
   1) ตั้งค่าการเชื่อมต่อ Supabase — แก้ 2 บรรทัดนี้เป็นค่าของคุณเอง
   ดูวิธีหาค่าได้จากคู่มือ "ขั้นตอนที่ 5" (Project Settings > API Keys)
   ============================================================ */
const SUPABASE_URL = "https://ejiwykqjvzgmsejubldw.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_dSILo3nVbImYYneA_lDdvg_TK5sQqLT";

/* ============================================================
   2) ตัวแปรและ element อ้างอิง
   ============================================================ */
let supabaseClient = null;
let books = [];
let history = [];
let activeTab = "books";
let activeFilter = "all";
let pendingBorrowBookId = null;

const statusChip = document.getElementById("connection-status");
const statusDot = document.getElementById("status-dot");
const statusTitle = document.getElementById("status-title");
const statusCopy = document.getElementById("status-copy");

const bookGrid = document.getElementById("book-grid");
const bookEmpty = document.getElementById("book-empty");
const bookSearch = document.getElementById("book-search");

const historyList = document.getElementById("history-list");
const historyEmpty = document.getElementById("history-empty");

const addBookModal = document.getElementById("add-book-modal");
const addBookForm = document.getElementById("add-book-form");
const addBookMessage = document.getElementById("add-book-message");

const borrowModal = document.getElementById("borrow-modal");
const borrowForm = document.getElementById("borrow-form");
const borrowMessage = document.getElementById("borrow-message");
const borrowBookTitle = document.getElementById("borrow-book-title");

const deleteModal = document.getElementById("delete-modal");
const deleteBookTitleEl = document.getElementById("delete-book-title");
const confirmDeleteBtn = document.getElementById("confirm-delete-btn");
let pendingDeleteBookId = null;

const clearHistoryModal = document.getElementById("clear-history-modal");
const confirmClearHistoryBtn = document.getElementById("confirm-clear-history-btn");

/* ============================================================
   3) เชื่อมต่อ Supabase และตรวจสอบสถานะ
   ============================================================ */
function isPlaceholder() {
  return SUPABASE_URL.includes("YOUR-PROJECT-REF") || SUPABASE_ANON_KEY.includes("ใส่ค่าของคุณ");
}

function setStatus(kind, title, copy) {
  statusChip.className = "status-chip flex shrink-0 items-center gap-3 rounded-2xl px-4 py-3 text-white backdrop-blur-sm status-chip--" + kind;
  statusTitle.textContent = title;
  statusCopy.textContent = copy;
}

async function initSupabase() {
  if (isPlaceholder()) {
    setStatus("error", "ยังไม่ได้ตั้งค่า Supabase", "แก้ SUPABASE_URL และ SUPABASE_ANON_KEY ใน script.js");
    return;
  }
  try {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { error: booksErr } = await supabaseClient.from("books").select("id").limit(1);
    if (booksErr) throw booksErr;
    const { error: historyErr } = await supabaseClient.from("borrow_history").select("id").limit(1);
    if (historyErr) throw historyErr;
    setStatus("ok", "เชื่อมต่อฐานข้อมูล Supabase สำเร็จ", "ข้อมูลจะอัปเดตแบบเรียลไทม์");
    await Promise.all([loadBooks(), loadHistory()]);
    subscribeRealtime();
  } catch (err) {
    console.error("Supabase connection error:", err);
    setStatus("error", "เชื่อมต่อไม่สำเร็จ", "ตรวจสอบ URL/Key และการตั้งค่า RLS (ดู Console สำหรับรายละเอียด)");
  }
}

function subscribeRealtime() {
  supabaseClient
    .channel("library-realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: "books" }, () => loadBooks())
    .on("postgres_changes", { event: "*", schema: "public", table: "borrow_history" }, () => loadHistory())
    .subscribe();
}

/* ============================================================
   4) โหลดและแสดงผลหนังสือ
   ============================================================ */
async function loadBooks() {
  const { data, error } = await supabaseClient.from("books").select("*").order("created_at", { ascending: false });
  if (error) { console.error("loadBooks error:", error); return; }
  books = data || [];
  renderBooks();
  updateSummary();
}

function updateSummary() {
  document.getElementById("total-count").textContent = books.length;
  document.getElementById("available-count").textContent = books.filter(b => b.status === "available").length;
  document.getElementById("borrowed-count").textContent = books.filter(b => b.status === "borrowed" && !isOverdue(b)).length;
  document.getElementById("overdue-count").textContent = books.filter(isOverdue).length;
}

function getFilteredBooks() {
  const query = bookSearch.value.trim().toLowerCase();
  return books
    .filter(b => {
      if (activeFilter === "all") return true;
      if (activeFilter === "overdue") return isOverdue(b);
      if (activeFilter === "borrowed") return b.status === "borrowed";
      return b.status === activeFilter;
    })
    .filter(b => [b.title, b.author, b.category].filter(Boolean).join(" ").toLowerCase().includes(query));
}

function formatDate(value, withTime) {
  if (!value) return "-";
  const options = withTime
    ? { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }
    : { day: "numeric", month: "short", year: "numeric" };
  return new Intl.DateTimeFormat("th-TH", options).format(new Date(value));
}

function isOverdue(book) {
  if (book.status !== "borrowed" || !book.due_date) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(book.due_date + "T00:00:00").getTime() < today.getTime();
}

function renderBooks() {
  const visible = getFilteredBooks();
  bookGrid.innerHTML = "";
  visible.forEach((book) => {
    const fragment = document.getElementById("book-card-template").content.cloneNode(true);
    const card = fragment.querySelector(".book-card");
    card.dataset.bookId = book.id;

    card.querySelector(".book-title").textContent = book.title;
    card.querySelector(".book-author").textContent = book.author || "ไม่ระบุผู้แต่ง";
    card.querySelector(".book-category").textContent = book.category || "ไม่ระบุหมวดหมู่";

    const statusEl = card.querySelector(".book-status");
    const borrowInfo = card.querySelector(".book-borrow-info");
    const borrowBtn = card.querySelector(".book-borrow-btn");
    const returnBtn = card.querySelector(".book-return-btn");

    if (book.status === "borrowed") {
      const overdue = isOverdue(book);
      statusEl.className = "book-status status-pill " + (overdue ? "status-overdue" : "status-borrowed");
      statusEl.textContent = overdue ? "เกินกำหนด" : "กำลังถูกยืม";
      borrowInfo.classList.remove("hidden");
      borrowInfo.classList.toggle("bg-[#fff0df]", overdue);
      borrowInfo.classList.toggle("text-[#a94e14]", overdue);
      borrowInfo.classList.toggle("bg-[#fff7ee]", !overdue);
      borrowInfo.classList.toggle("text-[#8a5a20]", !overdue);
      card.querySelector(".book-borrower-line").textContent = `ผู้ยืม: ${book.borrower_name || "-"}${book.borrower_class ? " (" + book.borrower_class + ")" : ""}`;
      card.querySelector(".book-due-line").textContent = (overdue ? "เลยกำหนดคืน: " : "กำหนดคืน: ") + formatDate(book.due_date, false);
      borrowBtn.classList.add("hidden");
      returnBtn.classList.remove("hidden");
    } else {
      statusEl.className = "book-status status-pill status-available";
      statusEl.textContent = "พร้อมให้ยืม";
      borrowInfo.classList.add("hidden");
      borrowBtn.classList.remove("hidden");
      returnBtn.classList.add("hidden");
    }

    borrowBtn.addEventListener("click", () => openBorrowModal(book));
    returnBtn.addEventListener("click", () => returnBook(book));
    card.querySelector(".book-delete-btn").addEventListener("click", () => openDeleteModal(book));

    bookGrid.appendChild(fragment);
  });

  bookEmpty.classList.toggle("hidden", visible.length > 0);
  bookGrid.classList.toggle("hidden", visible.length === 0);
  lucide.createIcons();
}

/* ============================================================
   5) เพิ่มหนังสือใหม่
   ============================================================ */
document.getElementById("open-add-book").addEventListener("click", () => {
  addBookForm.reset();
  addBookMessage.classList.add("hidden");
  addBookModal.classList.remove("hidden");
});

addBookForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabaseClient) return;

  const title = document.getElementById("new-title").value.trim();
  const author = document.getElementById("new-author").value.trim();
  const category = document.getElementById("new-category").value.trim();

  if (!title) {
    showFormMessage(addBookMessage, "กรุณากรอกชื่อหนังสือ", "error");
    return;
  }

  const { error } = await supabaseClient.from("books").insert({
    title,
    author: author || null,
    category: category || null,
    status: "available"
  });

  if (error) {
    console.error("addBook error:", error);
    showFormMessage(addBookMessage, "เพิ่มหนังสือไม่สำเร็จ กรุณาลองอีกครั้ง", "error");
    return;
  }

  showFormMessage(addBookMessage, "เพิ่มหนังสือเรียบร้อย", "success");
  await loadBooks();
  setTimeout(() => addBookModal.classList.add("hidden"), 600);
});

/* ============================================================
   6) ยืมหนังสือ
   ============================================================ */
function openBorrowModal(book) {
  pendingBorrowBookId = book.id;
  document.getElementById("borrow-book-id").value = book.id;
  borrowBookTitle.textContent = book.title;
  borrowForm.reset();
  borrowMessage.classList.add("hidden");
  borrowModal.classList.remove("hidden");
}

borrowForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabaseClient || !pendingBorrowBookId) return;

  const name = document.getElementById("borrow-name").value.trim();
  const klass = document.getElementById("borrow-class").value.trim();
  const dueDate = document.getElementById("borrow-due").value;
  const book = books.find(b => b.id === pendingBorrowBookId);

  if (!name || !dueDate) {
    showFormMessage(borrowMessage, "กรุณากรอกชื่อผู้ยืมและวันครบกำหนดคืน", "error");
    return;
  }

  const { error: updateError } = await supabaseClient
    .from("books")
    .update({
      status: "borrowed",
      borrower_name: name,
      borrower_class: klass || null,
      borrow_date: new Date().toISOString(),
      due_date: dueDate
    })
    .eq("id", pendingBorrowBookId);

  if (updateError) {
    console.error("borrow update error:", updateError);
    showFormMessage(borrowMessage, "บันทึกการยืมไม่สำเร็จ กรุณาลองอีกครั้ง", "error");
    return;
  }

  const { error: historyError } = await supabaseClient.from("borrow_history").insert({
    book_id: pendingBorrowBookId,
    book_title: book ? book.title : "",
    borrower_name: name,
    borrower_class: klass || null,
    action: "borrow"
  });
  if (historyError) {
    console.error("history insert error:", historyError);
    showFormMessage(borrowMessage, "บันทึกการยืมสำเร็จ แต่บันทึกประวัติไม่สำเร็จ (เช็ค RLS ของตาราง borrow_history)", "error");
    await Promise.all([loadBooks(), loadHistory()]);
    return;
  }

  showFormMessage(borrowMessage, "บันทึกการยืมเรียบร้อย", "success");
  await Promise.all([loadBooks(), loadHistory()]);
  setTimeout(() => borrowModal.classList.add("hidden"), 600);
});

/* ============================================================
   7) ลบหนังสือ
   ============================================================ */
function openDeleteModal(book) {
  pendingDeleteBookId = book.id;
  deleteBookTitleEl.textContent = book.title;
  deleteModal.classList.remove("hidden");
}

confirmDeleteBtn.addEventListener("click", async () => {
  if (!supabaseClient || !pendingDeleteBookId) return;

  confirmDeleteBtn.disabled = true;
  confirmDeleteBtn.classList.add("opacity-60", "cursor-not-allowed");

  const { error } = await supabaseClient.from("books").delete().eq("id", pendingDeleteBookId);

  confirmDeleteBtn.disabled = false;
  confirmDeleteBtn.classList.remove("opacity-60", "cursor-not-allowed");

  if (error) {
    console.error("deleteBook error:", error);
    alert("ลบหนังสือไม่สำเร็จ กรุณาลองอีกครั้ง");
    return;
  }

  pendingDeleteBookId = null;
  deleteModal.classList.add("hidden");
  await loadBooks();
});

/* ============================================================
   8) รับคืนหนังสือ
   ============================================================ */
async function returnBook(book) {
  if (!supabaseClient) return;

  const { error: updateError } = await supabaseClient
    .from("books")
    .update({
      status: "available",
      borrower_name: null,
      borrower_class: null,
      borrow_date: null,
      due_date: null
    })
    .eq("id", book.id);

  if (updateError) {
    console.error("return update error:", updateError);
    return;
  }

  const { error: historyError } = await supabaseClient.from("borrow_history").insert({
    book_id: book.id,
    book_title: book.title,
    borrower_name: book.borrower_name,
    borrower_class: book.borrower_class,
    action: "return"
  });
  if (historyError) {
    console.error("history insert error:", historyError);
    alert("รับคืนหนังสือสำเร็จ แต่บันทึกประวัติไม่สำเร็จ (เช็ค RLS ของตาราง borrow_history)");
  }

  await Promise.all([loadBooks(), loadHistory()]);
}

/* ============================================================
   9) ประวัติการยืม–คืน
   ============================================================ */
async function loadHistory() {
  const { data, error } = await supabaseClient
    .from("borrow_history")
    .select("*")
    .order("action_date", { ascending: false })
    .limit(200);
  if (error) { console.error("loadHistory error:", error); return; }
  history = data || [];
  renderHistory();
}

function renderHistory() {
  const clearBtn = document.getElementById("open-clear-history");
  clearBtn.disabled = history.length === 0;
  clearBtn.classList.toggle("opacity-50", history.length === 0);
  clearBtn.classList.toggle("cursor-not-allowed", history.length === 0);

  historyList.innerHTML = "";
  history.forEach((row) => {
    const fragment = document.getElementById("history-row-template").content.cloneNode(true);
    fragment.querySelector(".hist-book-title").textContent = row.book_title || "-";
    fragment.querySelector(".hist-borrower").textContent = [row.borrower_name, row.borrower_class].filter(Boolean).join(" / ") || "-";
    const actionEl = fragment.querySelector(".hist-action");
    if (row.action === "borrow") {
      actionEl.className = "hist-action status-pill status-borrowed";
      actionEl.textContent = "ยืม";
    } else {
      actionEl.className = "hist-action status-pill status-returned";
      actionEl.textContent = "คืน";
    }
    fragment.querySelector(".hist-date").textContent = formatDate(row.action_date, true);
    historyList.appendChild(fragment);
  });
  historyEmpty.classList.toggle("hidden", history.length > 0);
  historyList.parentElement.parentElement.classList.toggle("hidden", history.length === 0);
}

/* ============================================================
   10) ล้างประวัติทั้งหมด
   ============================================================ */
document.getElementById("open-clear-history").addEventListener("click", () => {
  if (!history.length) return;
  clearHistoryModal.classList.remove("hidden");
});

confirmClearHistoryBtn.addEventListener("click", async () => {
  if (!supabaseClient) return;

  confirmClearHistoryBtn.disabled = true;
  confirmClearHistoryBtn.classList.add("opacity-60", "cursor-not-allowed");

  const { error } = await supabaseClient.from("borrow_history").delete().gte("id", 0);

  confirmClearHistoryBtn.disabled = false;
  confirmClearHistoryBtn.classList.remove("opacity-60", "cursor-not-allowed");

  if (error) {
    console.error("clearHistory error:", error);
    alert("ล้างประวัติไม่สำเร็จ กรุณาลองอีกครั้ง");
    return;
  }

  clearHistoryModal.classList.add("hidden");
  await loadHistory();
});

/* ============================================================
   11) แท็บ, ตัวกรอง, ค้นหา, modal
   ============================================================ */
document.querySelectorAll(".main-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    activeTab = tab.dataset.tab;
    document.querySelectorAll(".main-tab").forEach(t => t.classList.toggle("is-active", t === tab));
    document.getElementById("tab-books").classList.toggle("hidden", activeTab !== "books");
    document.getElementById("tab-history").classList.toggle("hidden", activeTab !== "history");
  });
});

document.querySelectorAll("[data-filter]").forEach((btn) => {
  btn.addEventListener("click", () => {
    activeFilter = btn.dataset.filter;
    document.querySelectorAll("[data-filter]").forEach(b => b.classList.toggle("is-active", b === btn));
    renderBooks();
  });
});

bookSearch.addEventListener("input", renderBooks);

document.querySelectorAll("[data-close-modal]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.getElementById(btn.dataset.closeModal).classList.add("hidden");
  });
});
[addBookModal, borrowModal, deleteModal, clearHistoryModal].forEach((modal) => {
  modal.addEventListener("click", (event) => {
    if (event.target === modal) modal.classList.add("hidden");
  });
});

function showFormMessage(el, text, type) {
  el.textContent = text;
  el.className = "mt-3 rounded-xl px-3 py-2 text-sm font-medium";
  el.classList.add(type === "success" ? "bg-emerald-50" : "bg-red-50");
  el.classList.add(type === "success" ? "text-emerald-700" : "text-red-700");
}

/* ============================================================
   12) เริ่มทำงาน
   ============================================================ */
document.addEventListener("DOMContentLoaded", () => {
  lucide.createIcons();
  initSupabase();
});
