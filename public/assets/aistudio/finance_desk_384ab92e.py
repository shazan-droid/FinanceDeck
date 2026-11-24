"""
FinanceDesk - local desktop finance app.
Tabs: Overview | Working Capital | Long Term | Investments
Data stays on your machine (SQLite in ~/FinanceDesk/data.db).
PDF reports are named ddmmyyyy_<report>.pdf, e.g. 20112026_incomestatement.pdf
"""
import re
import sys
import sqlite3
import datetime as dt
from pathlib import Path

from PySide6.QtCore import Qt, QDate, QThread, Signal, QUrl, QStandardPaths
from PySide6.QtGui import QDesktopServices
from PySide6.QtWidgets import (
    QApplication, QMainWindow, QTabWidget, QWidget, QVBoxLayout, QHBoxLayout, QGridLayout,
    QLabel, QPushButton, QTableWidget, QTableWidgetItem, QDialog, QFormLayout, QLineEdit,
    QDoubleSpinBox, QDateEdit, QComboBox, QDialogButtonBox, QMessageBox, QFrame, QSplitter,
    QFileDialog, QAbstractItemView, QHeaderView)

from matplotlib.figure import Figure
from matplotlib.backends.backend_qtagg import FigureCanvasQTAgg
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Table, TableStyle, Spacer

APP_DIR = Path.home() / "FinanceDesk"
DB = APP_DIR / "data.db"
BLACK, CRIMSON = colors.HexColor("#0B0B0B"), colors.HexColor("#C1121F")
HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36"}

CATEGORIES = ["Salary", "Business income", "Gifts received", "Investment income", "Other income",
              "Rent", "Food & groceries", "Transport", "Utilities & data", "Education", "Health", "Charity",
              "Family support", "Loan repayment", "Investment purchase", "Investment sale", "Other"]

SCHEMA = """
CREATE TABLE IF NOT EXISTS transactions(id INTEGER PRIMARY KEY, date TEXT, activity TEXT,
    category TEXT, description TEXT, amount REAL);
CREATE TABLE IF NOT EXISTS balance(id INTEGER PRIMARY KEY, section TEXT, name TEXT, amount REAL,
    date TEXT, type TEXT);
CREATE TABLE IF NOT EXISTS holdings(id INTEGER PRIMARY KEY, symbol TEXT, kind TEXT, units REAL,
    cost REAL, price REAL, updated TEXT, date TEXT, source TEXT, url TEXT, selector TEXT, regex TEXT);
CREATE TABLE IF NOT EXISTS indicators(id INTEGER PRIMARY KEY, name TEXT, url TEXT, selector TEXT,
    regex TEXT, value TEXT, updated TEXT);
CREATE TABLE IF NOT EXISTS settings(k TEXT PRIMARY KEY, v TEXT);
"""


# ----------------------------------------------------------------------------- data layer
def q(sql, args=()):
    c = sqlite3.connect(DB)
    c.row_factory = sqlite3.Row
    try:
        rows = c.execute(sql, args).fetchall()
        c.commit()
        return rows
    finally:
        c.close()


def init_db():
    APP_DIR.mkdir(exist_ok=True)
    c = sqlite3.connect(DB)
    c.executescript(SCHEMA)
    for table, cols in (("balance", ("date", "type")), ("holdings", ("date", "source", "url", "selector", "regex"))):
        have = {r[1] for r in c.execute(f"PRAGMA table_info({table})")}
        for col in cols:
            if col not in have:
                c.execute(f"ALTER TABLE {table} ADD COLUMN {col} TEXT")
    c.commit()
    c.close()


def setting(k, default=""):
    r = q("SELECT v FROM settings WHERE k=?", (k,))
    return r[0]["v"] if r else default


def set_setting(k, v):
    q("INSERT OR REPLACE INTO settings(k,v) VALUES(?,?)", (k, v))


def now():
    return dt.datetime.now().strftime("%Y-%m-%d %H:%M")


def snapshot():
    def s(sec):
        return q("SELECT COALESCE(SUM(amount),0) v FROM balance WHERE section=?", (sec,))[0]["v"]

    def bal(*types):
        return q(f"SELECT COALESCE(SUM(amount),0) v FROM balance WHERE type IN ({','.join('?' * len(types))})", types)[0]["v"]

    def hold(*kinds):
        marks = ",".join("?" * len(kinds)) if kinds else ""
        where = f"WHERE kind IN ({marks})" if kinds else ""
        return q(f"SELECT COALESCE(SUM(units*COALESCE(NULLIF(price,0),cost)),0) v FROM holdings {where}", kinds)[0]["v"]

    port = hold()
    ca, cl = s("current_asset"), s("current_liability")
    la, ll = s("longterm_asset") + port, s("longterm_liability")
    return dict(ca=ca, cl=cl, la=la, ll=ll, port=port, wc=ca - cl, nw=ca + la - cl - ll,
                bank=bal("Cash in bank"), hand=bal("Cash in hand"),
                stocks=hold("DSE Stock", "Stock", "ETF"), bf=hold("Bond", "Fund"))


def runway():
    cash = q("SELECT COALESCE(SUM(amount),0) v FROM balance WHERE section='current_asset' "
             "AND type IN ('Cash in bank','Cash in hand')")[0]["v"]
    since = (dt.date.today() - dt.timedelta(days=90)).isoformat()
    out = q("SELECT COALESCE(-SUM(amount),0) v FROM transactions WHERE amount<0 "
            "AND activity='operating' AND date>=?", (since,))[0]["v"]
    burn = out / 3
    return burn, (cash / burn if burn else None)


# ----------------------------------------------------------------------------- scrapers
def scrape(url, selector="", regex=""):
    """Generic page scraper: optional CSS selector, optional regex (group 1 wins)."""
    import requests
    from bs4 import BeautifulSoup
    resp = requests.get(url, headers=HEADERS, timeout=20)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    el = soup.select_one(selector) if selector else soup
    text = el.get_text(" ", strip=True) if el else ""
    m = re.search(regex or r"-?\d[\d,]*\.?\d*", text)
    return (m.group(1) if m.groups() else m.group(0)) if m else None


def to_num(t):
    m = re.search(r"-?\d[\d,]*\.?\d*", t or "")
    return float(m.group(0).replace(",", "")) if m else None


DSE_PAGES = ("https://dse.co.tz/en", "https://dse.co.tz/en/all-equities")
_NUM = re.compile(r"[\d,]+(?:\.\d+)?")
_PCT = re.compile(r"\W{0,3}[\d.]+\s*%")
_TICKER = re.compile(r"[A-Za-z][A-Za-z0-9 .&-]{1,24}")


def http_get(url):
    import requests
    r = requests.get(url, headers={**HEADERS, "Accept": "text/html,application/xhtml+xml",
                                   "Accept-Language": "en-US,en;q=0.9"}, timeout=25)
    r.raise_for_status()
    return r.text


def parse_board(html):
    """DSE lists each security as consecutive text items: TICKER, [traded value], price, change%."""
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "html.parser")
    for t in soup(["script", "style", "noscript"]):
        t.decompose()
    nodes, out = list(soup.stripped_strings), {}
    for i, n in enumerate(nodes):
        if not _TICKER.fullmatch(n):
            continue
        j, nums = i + 1, []
        while j < len(nodes) and len(nums) < 4 and _NUM.fullmatch(nodes[j]):
            nums.append(nodes[j])
            j += 1
        if nums and j < len(nodes) and _PCT.fullmatch(nodes[j]):
            out.setdefault(n.upper(), to_num(nums[-1]))
    return out


def dse_prices(need):
    """-> ({TICKER: price in TZS}, error text). Tries the DSE home page, then the all-equities page."""
    board, errs = {}, []
    for url in DSE_PAGES:
        try:
            for k, v in parse_board(http_get(url)).items():
                board.setdefault(k, v)
        except Exception as e:
            errs.append(f"{type(e).__name__}: {str(e)[:90]}")
        if need <= set(board):
            break
    if board:
        return board, ""
    return board, "; ".join(errs) or "no price board found on the DSE page (layout changed?)"


def refresh_prices():
    """Per-holding source: DSE board, Yahoo, Web (URL + selector/regex) or Manual (never touched)."""
    rows = q("SELECT * FROM holdings")

    def src_of(r):
        return r["source"] or ("DSE" if r["kind"] in ("DSE Stock", "Stock", "ETF") else "Manual")

    need = {r["symbol"].upper() for r in rows if src_of(r) == "DSE"}
    board, err = dse_prices(need) if need else ({}, "")
    n, failed = 0, []
    for r in rows:
        src, px, why = src_of(r), None, "no price found"
        if src == "Manual":
            continue
        try:
            if src == "DSE":
                px = board.get(r["symbol"].upper())
                why = err or "not on the DSE board - check the ticker"
            elif src == "Yahoo":
                import yfinance as yf
                h = yf.Ticker(r["symbol"]).history(
                    period="5d")["Close"].dropna()
                px = float(h.iloc[-1]) if len(h) else None
            elif src == "Web":
                if not r["url"]:
                    why = "no URL set"
                else:
                    px = to_num(scrape(r["url"], r["selector"], r["regex"]))
                    why = "regex/selector found no number on the page"
        except Exception as e:
            why = f"{type(e).__name__}: {str(e)[:80]}"
        if px:
            q("UPDATE holdings SET price=?, updated=? WHERE id=?",
              (px, now(), r["id"]))
            n += 1
        else:
            failed.append(f"{r['symbol']} ({why})")
    msg = f"Updated {n} price(s)"
    return msg + (". Not updated: " + "; ".join(failed) if failed else "")


def refresh_indicators():
    n = 0
    for r in q("SELECT * FROM indicators"):
        try:
            val = scrape(r["url"], r["selector"], r["regex"]) or "n/a"
            n += 1
        except Exception as e:
            val = f"error: {type(e).__name__}"
        q("UPDATE indicators SET value=?, updated=? WHERE id=?",
          (val, now(), r["id"]))
    return f"Updated {n} indicators"


class Worker(QThread):
    done = Signal(str)

    def __init__(self, fn):
        super().__init__()
        self.fn = fn

    def run(self):
        try:
            self.done.emit(self.fn() or "Done")
        except Exception as e:
            self.done.emit(f"Error: {e}")


# ----------------------------------------------------------------------------- PDF reports
def fmt(v):
    if isinstance(v, (int, float)):
        return f"({abs(v):,.2f})" if v < 0 else f"{v:,.2f}"
    return "" if v is None else str(v)


def render_pdf(path, title, subtitle, blocks):
    def deco(c, d):
        w, h = A4
        c.saveState()
        c.setFillColor(BLACK)
        c.rect(0, h - 24 * mm, w, 24 * mm, fill=1, stroke=0)
        c.setFillColor(CRIMSON)
        c.rect(0, h - 25.2 * mm, w, 1.2 * mm, fill=1, stroke=0)
        c.setFillColor(colors.white)
        c.setFont("Helvetica-Bold", 16)
        c.drawString(18 * mm, h - 14 * mm, title)
        c.setFont("Helvetica", 9)
        c.setFillColor(colors.HexColor("#C0C0C0"))
        c.drawString(18 * mm, h - 20 * mm, subtitle)
        c.setFillColor(colors.grey)
        c.drawString(18 * mm, 10 * mm, f"Generated {now()} | FinanceDesk")
        c.drawRightString(w - 18 * mm, 10 * mm, f"Page {d.page}")
        c.restoreState()

    doc = SimpleDocTemplate(str(path), pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm,
                            topMargin=34 * mm, bottomMargin=18 * mm, title=title)
    hs = ParagraphStyle("h", parent=getSampleStyleSheet()["Heading2"], textColor=CRIMSON,
                        fontName="Helvetica-Bold", fontSize=12, spaceBefore=10, spaceAfter=4)
    story = []
    for b in blocks:
        story.append(Paragraph(b["title"], hs))
        data, style = [], [("FONTNAME", (0, 0), (-1, -1), "Helvetica"), ("FONTSIZE", (0, 0), (-1, -1), 9),
                           ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
                           ("LINEBELOW", (0, 0), (-1, -1),
                            0.25, colors.HexColor("#DDDDDD")),
                           ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]
        if b.get("header"):
            data.append(b["header"])
            style += [("BACKGROUND", (0, 0), (-1, 0), BLACK), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                      ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold")]
        data += [[fmt(c) for c in r] for r in (b["rows"] or [["No entries"]])]
        if b.get("total"):
            data.append([fmt(c) for c in b["total"]])
            i = len(data) - 1
            style += [("FONTNAME", (0, i), (-1, i), "Helvetica-Bold"),
                      ("LINEABOVE", (0, i), (-1, i), 1, CRIMSON)]
        ncol = max(len(r) for r in data)
        data = [r + [""] * (ncol - len(r)) for r in data]
        story += [Table(data, colWidths=[110 * mm, None] if ncol == 2 else None, style=TableStyle(style)),
                  Spacer(1, 4)]
    doc.build(story, onFirstPage=deco, onLaterPages=deco)


def _bal(section):
    return [(r["name"], r["amount"]) for r in q("SELECT name, amount FROM balance WHERE section=? ORDER BY name", (section,))]


def _total(rows):
    return sum(v for _, v in rows)


def rep_income(a, b):
    rows = q("SELECT category, SUM(amount) s FROM transactions WHERE activity='operating' AND date BETWEEN ? AND ? "
             "GROUP BY category, (amount>0) ORDER BY s DESC", (a, b))
    rev = [(r["category"], r["s"]) for r in rows if r["s"] > 0]
    exp = [(r["category"], -r["s"]) for r in rows if r["s"] < 0]
    tr, te = _total(rev), _total(exp)
    return [dict(title="Revenue / Income", rows=rev, total=("Total income", tr)),
            dict(title="Expenses", rows=exp, total=("Total expenses", te)),
            dict(title="Result", rows=[("Net income (income - expenses)", tr - te),
                                       ("Savings rate", f"{(tr - te) / tr * 100:.1f}%" if tr else "n/a")])]


def rep_balance(a, b):
    s = snapshot()
    la = _bal("longterm_asset") + \
        [("Investment portfolio (market value)", s["port"])]
    return [dict(title="Current assets", rows=_bal("current_asset"), total=("Total current assets", s["ca"])),
            dict(title="Non-current assets", rows=la,
                 total=("Total non-current assets", s["la"])),
            dict(title="Current liabilities", rows=_bal("current_liability"),
                 total=("Total current liabilities", s["cl"])),
            dict(title="Long-term liabilities", rows=_bal("longterm_liability"),
                 total=("Total long-term liabilities", s["ll"])),
            dict(title="Equity", rows=[("Total assets", s["ca"] + s["la"]), ("Total liabilities", s["cl"] + s["ll"])],
                 total=("Net worth (equity)", s["nw"]))]


def rep_cashflow(a, b):
    blocks, net = [], 0
    for act in ("operating", "investing", "financing"):
        rows = [(r["category"], r["s"]) for r in q(
            "SELECT category, SUM(amount) s FROM transactions WHERE activity=? AND date BETWEEN ? AND ? "
            "GROUP BY category ORDER BY s DESC", (act, a, b))]
        net += _total(rows)
        blocks.append(dict(title=f"{act.capitalize()} activities", rows=rows,
                           total=(f"Net cash from {act} activities", _total(rows))))
    blocks.append(dict(title="Summary", rows=[],
                  total=("Net change in cash", net)))
    return blocks


def rep_wc(a, b):
    s = snapshot()
    burn, run = runway()
    ratio = f"{s['ca'] / s['cl']:.2f}" if s["cl"] else "n/a"
    return [dict(title="Current assets", rows=_bal("current_asset"), total=("Total current assets", s["ca"])),
            dict(title="Current liabilities", rows=_bal("current_liability"),
                 total=("Total current liabilities", s["cl"])),
            dict(title="Working capital metrics", rows=[
                ("Working capital", s["wc"]), ("Current ratio", ratio),
                ("Average monthly operating outflow (last 90 days)", burn),
                ("Cash runway (months)", f"{run:.1f}" if run is not None else "n/a")])]


def rep_inv(a, b):
    hs = q("SELECT * FROM holdings WHERE units>0 ORDER BY symbol")
    rows, tv, tc, alloc = [], 0, 0, {}
    for h in hs:
        px = h["price"] or h["cost"]
        val, cost = h["units"] * px, h["units"] * h["cost"]
        tv, tc = tv + val, tc + cost
        alloc[h["kind"]] = alloc.get(h["kind"], 0) + val
        rows.append([h["symbol"], h["kind"], h["units"], h["cost"], px, val, val - cost,
                     f"{(val - cost) / cost * 100:.1f}%" if cost else "n/a"])
    ind = [[r["name"], r["value"] or "-", r["updated"] or "-"]
           for r in q("SELECT * FROM indicators ORDER BY name")]
    return [dict(title="Holdings", header=["Symbol", "Type", "Units", "Avg cost", "Price", "Value", "P/L", "P/L %"],
                 rows=rows, total=["Total", "", "", tc, "", tv, tv - tc, f"{(tv - tc) / tc * 100:.1f}%" if tc else "n/a"]),
            dict(title="Allocation", rows=[
                 (k, f"{v:,.2f}  ({v / tv * 100:.1f}%)") for k, v in alloc.items()] if tv else []),
            dict(title="Market indicators", header=["Indicator", "Value", "Updated"], rows=ind)]


def rep_networth(a, b):
    s = snapshot()
    ta, tl = s["ca"] + s["la"], s["cl"] + s["ll"]
    target = float(setting("target", "100000000")) or 1
    cf = sum(r["amount"] for r in q(
        "SELECT amount FROM transactions WHERE date BETWEEN ? AND ?", (a, b)))
    return [dict(title="Net worth summary", rows=[
        ("Total assets", ta), ("   of which investments",
                               s["port"]), ("Total liabilities", tl),
        ("Debt-to-assets", f"{tl / ta * 100:.1f}%" if ta else "n/a"), ("Net cash flow in period", cf)],
        total=("Net worth", s["nw"])),
        dict(title="Progress to target", rows=[
            ("Target net worth", target), ("Progress",
                                           f"{s['nw'] / target * 100:.1f}%"),
            ("Cash in bank", s["bank"]), ("Cash in hand", s["hand"]),
            ("Stocks owned (DSE stocks, ETFs)", s["stocks"]), ("Bonds & funds", s["bf"])])]


REPORTS = {  # key -> (title, builder, uses_period)
    "incomestatement": ("Income Statement", rep_income, True),
    "balancesheet": ("Balance Sheet", rep_balance, False),
    "cashflowstatement": ("Cash Flow Statement", rep_cashflow, True),
    "workingcapital": ("Working Capital Report", rep_wc, False),
    "investmentportfolio": ("Investment Portfolio", rep_inv, False),
    "networth": ("Net Worth Summary", rep_networth, False),
}


def generate(keys, outdir, a, b):
    outdir = Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    cur, out = setting("currency", "TZS"), []
    for k in keys:
        title, fn, period = REPORTS[k]
        sub = f"{a} to {b}  |  Currency: {cur}" if period else f"As at {dt.date.today():%d %b %Y}  |  Currency: {cur}"
        path = outdir / f"{dt.date.today():%d%m%Y}_{k}.pdf"
        render_pdf(path, title, sub, fn(a, b))
        out.append(path)
    return out


# ----------------------------------------------------------------------------- UI building blocks
class FieldDialog(QDialog):
    def __init__(self, cols, values=None, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Entry")
        self.setMinimumWidth(420)
        form = QFormLayout(self)
        self.w = {}
        for field, label, kind, choices in cols:
            v = values.get(field) if values else None
            if kind == "num":
                w = QDoubleSpinBox()
                w.setRange(-1e12, 1e12)
                w.setDecimals(2)
                w.setGroupSeparatorShown(True)
                w.setValue(float(v or 0))
            elif kind == "date":
                w = QDateEdit(calendarPopup=True)
                w.setDisplayFormat("yyyy-MM-dd")
                w.setDate(QDate.fromString(v, "yyyy-MM-dd")
                          if v else QDate.currentDate())
            elif kind in ("choice", "combo"):
                w = QComboBox()
                for c in choices:
                    if isinstance(c, tuple):
                        w.addItem(c[0], c[1])  # (label, stored value)
                    else:
                        w.addItem(c)
                if kind == "combo":
                    w.setEditable(True)
                    w.setCurrentText(v or "")
                elif v is not None:
                    i = w.findData(v) if isinstance(
                        choices[0], tuple) else w.findText(v)
                    w.setCurrentIndex(max(i, 0))
            else:
                w = QLineEdit(str(v or ""))
            form.addRow(label, w)
            self.w[field] = (w, kind)
        bb = QDialogButtonBox(QDialogButtonBox.Save | QDialogButtonBox.Cancel)
        bb.accepted.connect(self.accept)
        bb.rejected.connect(self.reject)
        form.addRow(bb)

    def data(self):
        out = {}
        for f, (w, kind) in self.w.items():
            out[f] = (w.value() if kind == "num" else w.date().toString("yyyy-MM-dd") if kind == "date"
                      else (w.currentData() if w.currentData() is not None else w.currentText()) if kind == "choice"
                      else w.currentText().strip() if kind == "combo" else w.text().strip())
        return out


class Crud(QWidget):
    """Table + Add/Edit/Delete bound to one SQLite table."""
    changed = Signal()

    def __init__(self, table, cols, extra=(), where="", order="id DESC", title="", hidden=()):
        super().__init__()
        self.table, self.cols, self.extra, self.where, self.order = table, cols, list(
            extra), where, order
        self.hidden = set(hidden)
        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        top = QHBoxLayout()
        if title:
            t = QLabel(title)
            t.setStyleSheet("font-size:15px;font-weight:600;color:#fff")
            top.addWidget(t)
        top.addStretch()
        self.bar = top
        for text, fn in (("Add", self.add), ("Edit", self.edit), ("Delete", self.delete)):
            btn = QPushButton(text)
            if text == "Add":
                btn.setObjectName("primary")
            btn.clicked.connect(fn)
            top.addWidget(btn)
        lay.addLayout(top)
        heads = [c[1] for c in cols if c[0] not in self.hidden] + [e[1]
                                                                   for e in self.extra]
        self.t = QTableWidget(0, len(heads))
        self.t.setHorizontalHeaderLabels(heads)
        self.t.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        self.t.verticalHeader().setVisible(False)
        self.t.verticalHeader().setDefaultSectionSize(34)
        self.t.setShowGrid(False)
        self.t.setAlternatingRowColors(True)
        self.t.setFocusPolicy(Qt.NoFocus)
        self.t.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.t.setSelectionMode(QAbstractItemView.SingleSelection)
        self.t.doubleClicked.connect(lambda *_: self.edit())
        lay.addWidget(self.t)
        self.load()

    def load(self):
        rows = q(
            f"SELECT * FROM {self.table} {self.where} ORDER BY {self.order}")
        fields = [c[0] for c in self.cols if c[0]
                  not in self.hidden] + [e[0] for e in self.extra]
        self.t.setRowCount(len(rows))
        labels = {c[0]: {val: lab for lab, val in c[3]} for c in self.cols
                  if c[2] == "choice" and c[3] and isinstance(c[3][0], tuple)}
        for i, r in enumerate(rows):
            for j, f in enumerate(fields):
                v = r[f]
                v = labels.get(f, {}).get(v, v)
                it = QTableWidgetItem(f"{v:,.2f}" if isinstance(
                    v, float) else "" if v is None else str(v))
                it.setFlags(it.flags() & ~Qt.ItemIsEditable)
                if isinstance(v, (int, float)):
                    it.setTextAlignment(Qt.AlignRight | Qt.AlignVCenter)
                if j == 0:
                    it.setData(Qt.UserRole, r["id"])
                self.t.setItem(i, j, it)

    def _sel(self):
        r = self.t.currentRow()
        return self.t.item(r, 0).data(Qt.UserRole) if r >= 0 else None

    def _done(self):
        self.load()
        self.changed.emit()

    def add(self):
        d = FieldDialog(self.cols, parent=self)
        if d.exec():
            v = d.data()
            names = ",".join(v)
            q(f"INSERT INTO {self.table}({names}) VALUES({','.join('?' * len(v))})",
              tuple(v.values()))
            self._done()

    def edit(self):
        rid = self._sel()
        if rid is None:
            return
        cur = dict(q(f"SELECT * FROM {self.table} WHERE id=?", (rid,))[0])
        d = FieldDialog(self.cols, cur, self)
        if d.exec():
            v = d.data()
            q(f"UPDATE {self.table} SET {','.join(f + '=?' for f in v)} WHERE id=?",
              (*v.values(), rid))
            self._done()

    def delete(self):
        rid = self._sel()
        if rid is not None and QMessageBox.question(self, "Delete", "Delete the selected row?") == QMessageBox.Yes:
            q(f"DELETE FROM {self.table} WHERE id=?", (rid,))
            self._done()


def kpi_card(title):
    f = QFrame()
    f.setStyleSheet(
        "QFrame{background:#121212;border-radius:8px}QLabel{background:transparent}")
    lay = QVBoxLayout(f)
    lay.setContentsMargins(16, 12, 16, 12)
    lay.setSpacing(2)
    a = QLabel(title.upper())
    a.setStyleSheet(
        "color:#7C7C7C;font-size:10px;letter-spacing:1.5px;font-weight:600")
    v = QLabel("-")
    v.setStyleSheet("font-size:21px;font-weight:600;color:#fff")
    lay.addWidget(a)
    lay.addWidget(v)
    return f, v


def money(v):
    return f"{setting('currency', 'TZS')} {fmt(v)}"


class KpiRow(QWidget):
    def __init__(self, names):
        super().__init__()
        lay = QHBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        self.v = {}
        for n in names:
            f, v = kpi_card(n)
            self.v[self._key(n)] = v
            lay.addWidget(f)

    @staticmethod
    def _key(n):
        return re.sub(r"[^a-z]", "", n.lower())

    def set(self, **kw):
        for k, val in kw.items():
            self.v[self._key(k)].setText(val)


# ----------------------------------------------------------------------------- tabs
class WorkingCapitalTab(QWidget):
    def __init__(self):
        super().__init__()
        lay = QVBoxLayout(self)
        self.kpi = KpiRow(["Working capital", "Current ratio",
                          "Monthly burn", "Cash runway"])
        lay.addWidget(self.kpi)
        sp = QSplitter(Qt.Vertical)
        self.bal = Crud("balance", [("date", "As at", "date", None),
                                    ("section", "Class", "choice", [
                                     ("Assets", "current_asset"), ("Liabilities", "current_liability")]),
                                    ("type", "Type", "choice", [
                                     "Cash in bank", "Cash in hand", "Receivable", "Payable", "Property", "Loan", "Other"]),
                                    ("name", "Description", "text", None),
                                    ("amount", "Amount", "num", None)],
                        where="WHERE section LIKE 'current%'", order="section, name",
                        title="Current assets & liabilities")
        self.tx = Crud("transactions", [("date", "Date", "date", None),
                                        ("activity", "Activity", "choice",
                                         [("Operating", "operating"), ("Investing", "investing"),
                                          ("Financing", "financing")]),
                                        ("category", "Category",
                                         "combo", CATEGORIES),
                                        ("description", "Description", "text", None),
                                        ("amount", "Amount (+in / -out)", "num", None)],
                       order="date DESC, id DESC", title="Cash flow ledger")
        for c in (self.bal, self.tx):
            c.changed.connect(self.refresh)
            sp.addWidget(c)
        lay.addWidget(sp)

    def refresh(self):
        s = snapshot()
        burn, run = runway()
        self.kpi.set(Working_capital=money(s["wc"]), Current_ratio=f"{s['ca'] / s['cl']:.2f}" if s["cl"] else "n/a",
                     Monthly_burn=money(burn), Cash_runway=f"{run:.1f} months" if run is not None else "n/a")


class LongTermTab(QWidget):
    def __init__(self):
        super().__init__()
        lay = QVBoxLayout(self)
        self.kpi = KpiRow(
            ["Long-term assets", "Long-term liabilities", "Net worth", "Debt to assets"])
        lay.addWidget(self.kpi)
        self.bal = Crud("balance", [("date", "As at", "date", None),
                                    ("section", "Class", "choice", [
                                     ("Assets", "longterm_asset"), ("Liabilities", "longterm_liability")]),
                                    ("type", "Type", "choice", [
                                     "Cash in bank", "Cash in hand", "Receivable", "Payable", "Property", "Loan", "Other"]),
                                    ("name", "Description", "text", None),
                                    ("amount", "Amount", "num", None)],
                        where="WHERE section LIKE 'longterm%'", order="section, name",
                        title="Long-term assets & liabilities (investment portfolio is added automatically)")
        self.bal.changed.connect(self.refresh)
        lay.addWidget(self.bal)

    def refresh(self):
        s = snapshot()
        ta, tl = s["ca"] + s["la"], s["cl"] + s["ll"]
        self.kpi.set(Long_term_assets=money(s["la"]), Long_term_liabilities=money(s["ll"]),
                     Net_worth=money(s["nw"]), Debt_to_assets=f"{tl / ta * 100:.1f}%" if ta else "n/a")


class InvestmentsTab(QWidget):
    status = Signal(str)

    def __init__(self):
        super().__init__()
        lay = QVBoxLayout(self)
        self.kpi = KpiRow(["Portfolio value", "Cost basis",
                          "Unrealised P/L", "P/L %"])
        lay.addWidget(self.kpi)
        sp = QSplitter(Qt.Vertical)
        self.h = Crud("holdings", [
            ("symbol", "Ticker / name", "text", None),
            ("kind", "Type", "choice", [
             "DSE Stock", "ETF", "Bond", "Fund", "Stock", "Other"]),
            ("units", "Units", "num", None),
            ("cost", "Avg cost / unit", "num", None),
            ("date", "Date bought", "date", None),
            ("price", "Current price / NAV", "num", None),
            ("source", "Price source", "choice",
             ["DSE", "Web", "Yahoo", "Manual"]),
            ("url", "Price page URL (Web source only)", "text", None),
            ("selector", "CSS selector (Web source only)", "text", None),
            ("regex", "Regex (Web source only)", "text", None)],
            extra=[("updated", "Updated")], order="symbol", hidden={"url", "selector", "regex"},
            title="Holdings: DSE stocks, ETFs, bonds, funds")
        self.i = Crud("indicators", [("name", "Indicator name", "text", None), ("url", "URL", "text", None),
                                     ("selector", "CSS selector (optional)",
                                      "text", None),
                                     ("regex", "Regex (optional, group 1 = value)", "text", None)],
                      extra=[("value", "Latest value"), ("updated", "Updated")], order="name",
                      hidden={"selector", "regex"}, title="Market indicators")
        b1, b2, b3 = QPushButton("Refresh prices"), QPushButton(
            "Refresh indicators"), QPushButton("Add Tanzania starter list")
        b1.clicked.connect(lambda: self.run(refresh_prices))
        b2.clicked.connect(lambda: self.run(refresh_indicators))
        b3.clicked.connect(self.starter)
        self.h.bar.insertWidget(1, b3)
        self.h.bar.insertWidget(1, b1)
        self.i.bar.insertWidget(1, b2)
        for c in (self.h, self.i):
            c.changed.connect(self.refresh)
            sp.addWidget(c)
        lay.addWidget(sp)

    def starter(self):
        """Adds watch-only rows (0 units). Enter units and cost on a row to make it count in your totals."""
        today = dt.date.today().isoformat()
        # earlier starter rows that were never edited
        for old in ("CRDB", "NMB", "DSE", "TTP", "TBL", "IEACLC-ETF", "VIS-ETF", "iTRUST Bond",
                    "Inuka Money Market Fund"):
            q("DELETE FROM holdings WHERE symbol=? AND units=0 AND cost=0", (old,))
        utt = "https://uttamis.co.tz/uttamis2023/uttz/public/index.php"
        utt_re = r"Liquid Fund\s+[\d,]+\.\d+\s+[\d,]+\.\d+\s+([\d,]+\.\d+)"
        seeds = [(t, "DSE Stock", "DSE", "", "")
                 for t in ("PAL", "DCB", "AFRIPRISE", "VODA")]
        seeds += [(n, "ETF", "Manual", "", "") for n in
                  ("iAfrica Financials ETF", "iAfrica Mining & Energy ETF", "iAfrica Telco & Tech ETF")]
        seeds += [("Inuka Dozen Index Fund", "Fund", "Manual", "", ""),
                  ("UTT AMIS Liquid Fund", "Fund", "Web", utt, utt_re)]
        for sym, kind, src, url, rx in seeds:
            if not q("SELECT 1 FROM holdings WHERE symbol=?", (sym,)):
                q("INSERT INTO holdings(symbol,kind,units,cost,date,source,url,regex) VALUES(?,?,0,0,?,?,?,?)",
                  (sym, kind, today, src, url, rx))
        self.h.load()

    def run(self, fn):
        self.status.emit("Fetching... (needs internet)")
        self._w = Worker(fn)
        self._w.done.connect(self._finished)
        self._w.start()

    def _finished(self, msg):
        self.status.emit(msg)
        if "Not updated" in msg or msg.startswith("Error"):
            QMessageBox.information(self, "Refresh prices", msg)
        self.h.load()
        self.i.load()
        self.refresh()

    def refresh(self):
        r = q("SELECT COALESCE(SUM(units*COALESCE(NULLIF(price,0),cost)),0) v, COALESCE(SUM(units*cost),0) c "
              "FROM holdings WHERE units>0")[0]
        pl = r["v"] - r["c"]
        self.kpi.set(Portfolio_value=money(r["v"]), Cost_basis=money(r["c"]), Unrealised_P_L=money(pl),
                     P_L_=f"{pl / r['c'] * 100:.1f}%" if r["c"] else "n/a")


def default_outdir():
    desk = QStandardPaths.writableLocation(
        QStandardPaths.DesktopLocation) or str(Path.home() / "Desktop")
    return str(Path(desk) / "FinanceDesk Reports")


def style_ax(ax, title):
    ax.set_facecolor("#0B0B0B")
    ax.tick_params(colors="#9A9A9A", labelsize=8)
    for sp in ax.spines.values():
        sp.set_color("#222")
    ax.set_title(title, color="#fff", fontsize=10, loc="left", pad=10)


class OverviewTab(QWidget):
    def __init__(self):
        super().__init__()
        lay = QVBoxLayout(self)
        self.kpi = KpiRow(["Net worth", "Working capital",
                          "Portfolio value", "Net cash flow (period)"])
        lay.addWidget(self.kpi)

        row = QHBoxLayout()
        today = QDate.currentDate()
        self.d1 = QDateEdit(
            QDate(today.year(), today.month(), 1), calendarPopup=True)
        self.d2 = QDateEdit(today, calendarPopup=True)
        for d in (self.d1, self.d2):
            d.setDisplayFormat("yyyy-MM-dd")
            d.dateChanged.connect(self.refresh)
        self.cur = QLineEdit(setting("currency", "TZS"))
        self.cur.setMaximumWidth(64)
        self.cur.editingFinished.connect(lambda: (set_setting(
            "currency", self.cur.text().strip() or "TZS"), self.refresh()))
        self.target = QDoubleSpinBox()
        self.target.setRange(1, 1e15)
        self.target.setDecimals(0)
        self.target.setGroupSeparatorShown(True)
        self.target.setValue(float(setting("target", "100000000")))
        self.target.editingFinished.connect(lambda: (set_setting(
            "target", str(self.target.value())), self.refresh()))
        for w in (QLabel("Period"), self.d1, QLabel("to"), self.d2, QLabel("Currency"), self.cur,
                  QLabel("Target net worth"), self.target):
            row.addWidget(w)
        row.addStretch()
        lay.addLayout(row)

        self.fig1, self.fig2 = Figure(figsize=(5, 3), facecolor="#0B0B0B"), Figure(
            figsize=(5, 3), facecolor="#0B0B0B")
        self.c1, self.c2 = FigureCanvasQTAgg(
            self.fig1), FigureCanvasQTAgg(self.fig2)
        charts = QHBoxLayout()
        charts.addWidget(self.c1)
        charts.addWidget(self.c2)
        lay.addLayout(charts, 1)

        box = QHBoxLayout()
        saved = setting("outdir")
        self.out = QLineEdit(default_outdir() if not saved or saved == str(
            APP_DIR / "Reports") else saved)
        br, op = QPushButton("Browse"), QPushButton("Open folder")
        br.clicked.connect(self.browse)
        op.clicked.connect(lambda: QDesktopServices.openUrl(
            QUrl.fromLocalFile(self.out.text())))
        for w in (QLabel("Save PDFs to"), self.out, br, op):
            box.addWidget(w)
        lay.addLayout(box)

        grid = QGridLayout()
        grid.setSpacing(10)
        for n, (k, (title, _, _)) in enumerate(REPORTS.items()):
            b = QPushButton(title)
            b.clicked.connect(lambda _=False, key=k: self.make([key]))
            grid.addWidget(b, n // 3, n % 3)
        allb = QPushButton("Generate all reports")
        allb.setObjectName("primary")
        allb.clicked.connect(lambda: self.make(list(REPORTS)))
        grid.addWidget(allb, 2, 0, 1, 3)
        lay.addLayout(grid)

    def browse(self):
        p = QFileDialog.getExistingDirectory(
            self, "Choose folder", self.out.text())
        if p:
            self.out.setText(p)

    def make(self, keys):
        a, b = self.d1.date().toString("yyyy-MM-dd"), self.d2.date().toString("yyyy-MM-dd")
        set_setting("outdir", self.out.text())
        try:
            files = generate(keys, self.out.text(), a, b)
            QMessageBox.information(
                self, "Reports created", "\n".join(f.name for f in files))
        except Exception as e:
            QMessageBox.critical(self, "Error", str(e))

    def refresh(self, *_):
        a, b = self.d1.date().toString("yyyy-MM-dd"), self.d2.date().toString("yyyy-MM-dd")
        s, target = snapshot(), self.target.value()
        cur = setting("currency", "TZS")
        cf = q("SELECT COALESCE(SUM(amount),0) v FROM transactions WHERE date BETWEEN ? AND ?", (a, b))[
            0]["v"]
        self.kpi.set(Net_worth=money(s["nw"]), Working_capital=money(s["wc"]), Portfolio_value=money(s["port"]),
                     Net_cash_flow_period=money(cf))

        # Chart 1: net worth and its parts as % of the target
        items = [("Net worth", s["nw"]), ("Cash in bank", s["bank"]), ("Cash in hand", s["hand"]),
                 ("Stocks owned", s["stocks"]), ("Bonds & funds", s["bf"])][::-1]
        pcts = [v / target * 100 for _, v in items]
        self.fig1.clear()
        ax = self.fig1.add_subplot(111)
        ax.barh([n for n, _ in items], pcts, color=[
                "#8E8E8E"] * 4 + ["#C1121F"], height=0.55)
        for y, p in enumerate(pcts):
            ax.text(max(p, 0) + 1.5, y, f"{p:.1f}%",
                    va="center", color="#E0E0E0", fontsize=8)
        ax.axvline(100, color="#C1121F", ls="--", lw=1)
        ax.set_xlim(min(0, min(pcts) - 5), max(110, max(pcts) + 15))
        ax.set_xlabel(f"% of {cur} {target:,.0f} target",
                      color="#7C7C7C", fontsize=8)
        style_ax(ax, f"Net worth is {s['nw'] / target * 100:.1f}% of target")
        self.fig1.tight_layout()
        self.c1.draw_idle()

        # Chart 2: monthly operating income vs expenses
        rows = q("SELECT substr(date,1,7) m, SUM(CASE WHEN amount>0 THEN amount ELSE 0 END) i, "
                 "SUM(CASE WHEN amount<0 THEN -amount ELSE 0 END) o FROM transactions "
                 "WHERE activity='operating' GROUP BY m ORDER BY m DESC LIMIT 12")[::-1]
        self.fig2.clear()
        ax = self.fig2.add_subplot(111)
        x = list(range(len(rows)))
        ax.bar([i - 0.2 for i in x], [r["i"]
               for r in rows], 0.4, color="#C1121F", label="Income")
        ax.bar([i + 0.2 for i in x], [r["o"]
               for r in rows], 0.4, color="#A8A8A8", label="Expenses")
        ax.set_xticks(x)
        ax.set_xticklabels([r["m"] for r in rows], rotation=30)
        style_ax(ax, "Operating income vs expenses (12 months)")
        if rows:
            ax.legend(facecolor="#111", edgecolor="#222",
                      labelcolor="#ddd", fontsize=8)
        self.fig2.tight_layout()
        self.c2.draw_idle()


QSS = """
QWidget{background:#0B0B0B;color:#E8E8E8;font-family:'Segoe UI','Helvetica Neue',Arial;font-size:13px}
QTabWidget::pane{border:0}
QTabBar::tab{padding:12px 26px;color:#7C7C7C;border-bottom:2px solid transparent;margin-right:4px;font-weight:500}
QTabBar::tab:selected{color:#fff;border-bottom:2px solid #C1121F}
QTabBar::tab:hover{color:#ddd}
QPushButton{background:transparent;border:1px solid #2C2C2C;padding:7px 16px;border-radius:6px;color:#CFCFCF}
QPushButton:hover{border-color:#C1121F;color:#fff}
QPushButton#primary{background:#C1121F;border:0;color:#fff;font-weight:600}
QPushButton#primary:hover{background:#D91A28}
QTableWidget{background:#0F0F0F;alternate-background-color:#131313;border:0;gridline-color:transparent;
  selection-background-color:#2A0A0D;selection-color:#fff;outline:0}
QTableWidget::item{padding:4px 8px;border:0}
QHeaderView::section{background:#0B0B0B;color:#8A8A8A;border:0;border-bottom:1px solid #C1121F;padding:8px;font-weight:600}
QLineEdit,QDoubleSpinBox,QDateEdit,QComboBox{background:#141414;border:1px solid #2A2A2A;padding:6px 8px;border-radius:6px}
QLineEdit:focus,QDoubleSpinBox:focus,QDateEdit:focus,QComboBox:focus{border-color:#C1121F}
QDialog{background:#0F0F0F}
QSplitter::handle{background:#0B0B0B;height:10px}
QScrollBar:vertical{background:#0B0B0B;width:10px}
QScrollBar::handle:vertical{background:#2A2A2A;border-radius:5px;min-height:30px}
QScrollBar::add-line:vertical,QScrollBar::sub-line:vertical{height:0}
QStatusBar{color:#8A8A8A}
"""


class Main(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("FinanceDesk")
        self.resize(1240, 820)
        self.tabs = QTabWidget()
        self.inv = InvestmentsTab()
        for w, name in ((OverviewTab(), "Overview"), (WorkingCapitalTab(), "Working Capital"),
                        (LongTermTab(), "Long Term"), (self.inv, "Investments")):
            w.layout().setContentsMargins(22, 16, 22, 16)
            w.layout().setSpacing(14)
            self.tabs.addTab(w, name)
        brand = QLabel("FINANCEDESK  ")
        brand.setStyleSheet("color:#C1121F;font-weight:700;letter-spacing:2px")
        self.tabs.setCornerWidget(brand, Qt.TopRightCorner)
        self.tabs.currentChanged.connect(
            lambda i: self.tabs.widget(i).refresh())
        self.inv.status.connect(self.statusBar().showMessage)
        self.setCentralWidget(self.tabs)
        for i in range(self.tabs.count()):
            self.tabs.widget(i).refresh()


if __name__ == "__main__":
    init_db()
    app = QApplication(sys.argv)
    app.setStyleSheet(QSS)
    win = Main()
    win.show()
    sys.exit(app.exec())

