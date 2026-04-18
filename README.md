# IM Scan — Print Server

Print server lokal untuk mencetak badge event Indonesia Miner secara otomatis dari tablet (via LAN/WiFi). Tidak perlu internet — tablet langsung berkomunikasi ke laptop venue.

**Badge size: 105 × 150 mm**

---

## Quick Start

```bash
# 1. Install dependencies (sekali saja)
npm install

# 2. Buat file konfigurasi
cp .env.example .env        # Mac/Linux
copy .env.example .env      # Windows

# 3. Isi PRINTER_NAME di .env
# Cek nama printer: lpstat -a (Mac) | Get-Printer (Windows PowerShell)

# 4. Jalankan server
npm start
```

Buka **http://localhost:3000** → bagian **Test Print** → klik **Cetak Test Badge**.

Dari tablet, akses `http://[IP_LAPTOP]:3000/health` — harus muncul `{"ok":true}`.

---

## Cara Kerja

```
[Tablet/Flutter App]
        │
        │ POST /print (via WiFi lokal)
        ▼
[Print Server — Laptop ini]
        │
        │ generate PDF → kirim ke printer
        ▼
[Printer fisik]
```

Jika print gagal, job masuk antrian dan otomatis retry setiap 60 detik.

---

## Prasyarat

| Software | Keterangan |
|---|---|
| **Node.js 18+** | Download dari https://nodejs.org (pilih LTS) |
| **Printer** | Sudah terinstall dan terhubung ke laptop |

> **Catatan:** Saat pertama `npm install`, akan download Chromium (~300 MB) untuk render badge. Hanya sekali saja.

---

## Setup (Pertama Kali)

### 1. Download / Clone project ini

Letakkan folder project di laptop, misalnya di `C:\im-print-server\` (Windows) atau `~/im-print-server/` (Mac).

### 2. Install dependencies

Buka terminal / command prompt di folder project, jalankan:

```bash
npm install
```

Tunggu sampai selesai (bisa 5–10 menit pertama kali karena download Chromium).

### 3. Buat file konfigurasi

Copy file `.env.example` menjadi `.env`:

**Mac / Linux:**
```bash
cp .env.example .env
```

**Windows:**
```cmd
copy .env.example .env
```

Edit file `.env` sesuai kebutuhan:

```env
# Port (biarkan 3000 jika tidak ada konflik)
PORT=3000

# Nama printer — WAJIB diisi jika laptop punya lebih dari 1 printer
# Lihat cara cari nama printer di bawah
PRINTER_NAME=Canon_MG3600_series

# Nama event di header badge
EVENT_NAME=INDONESIA MINER 2026
EVENT_SUBTITLE=CONFERENCE AND EXHIBITION

# Nama sponsor (muncul di pojok kanan atas badge)
SPONSOR_NAME=FLS

# Jumlah copy default
DEFAULT_COPIES=1
```

### 4. Cari nama printer

**Mac:**
```bash
lpstat -a
```

**Windows (PowerShell):**
```powershell
Get-Printer | Select-Object Name
```

Atau, jalankan server dulu lalu buka: `http://localhost:3000/api/printers`

---

## Menjalankan Server

```bash
npm start
```

Atau untuk development (auto-restart saat file berubah):

```bash
npm run dev
```

Output saat berhasil:
```
✓ IM Scan Print Server running on port 3000
  Health check: http://localhost:3000/health
  Monitor UI:   http://localhost:3000/
  Printer:      Canon_MG3600_series
  Event:        INDONESIA MINER 2026
```

**Biarkan terminal ini tetap terbuka selama event berlangsung.**

---

## Verifikasi dari Tablet

Buka browser di tablet, ketik:

```
http://[IP_LAPTOP]:3000/health
```

Jika muncul `{"ok":true,...}` → koneksi berhasil.

**Cara cari IP laptop:**

Mac:
```bash
ipconfig getifaddr en0
```

Windows:
```cmd
ipconfig
# Lihat bagian "IPv4 Address"
```

---

## Monitor UI

Buka di browser laptop atau tablet:

```
http://[IP_LAPTOP]:3000
```

Fitur yang tersedia:
- Status server & printer
- Daftar antrian print (live refresh setiap 5 detik)
- Tombol retry untuk job yang gagal
- **Test print** — bisa langsung test cetak badge dari browser

---

## API Endpoint

### `GET /health`
Cek koneksi. Digunakan oleh tablet untuk verifikasi.

```json
{ "ok": true, "timestamp": "...", "printer": "Canon_MG3600", "event": "INDONESIA MINER 2026" }
```

### `POST /print`
Kirim perintah cetak badge.

**Request body:**
```json
{
  "display_name": "Calliope",
  "name": "Anastasia Nagisa",
  "company": "INDONESIAMINER BISNIS GLOBAL",
  "department": "Marketing & Corporate",
  "ticket_type": "DELEGATE",
  "qr_code": "EVT2026-A001",
  "badge_id": "A001",
  "guest_id": "uuid-xxx",
  "access": ["CONFERENCE", "EXHIBITION", "NETWORKING FUNCTIONS"],
  "copies": 1
}
```

| Field | Keterangan |
|---|---|
| `display_name` | Nama tampil besar (opsional, jika tidak ada pakai kata pertama dari `name`) |
| `name` | Nama lengkap |
| `company` | Nama perusahaan (uppercase otomatis) |
| `department` | Jabatan / departemen |
| `ticket_type` | DELEGATE, EXHIBITOR, SPEAKER, PRESS, VIP, ORGANIZER |
| `qr_code` | Isi QR code (string apapun) |
| `access` | Array area yang bisa diakses. Kosongkan untuk tampilkan semua 3 area. |
| `copies` | Jumlah copy (default: sesuai `.env`) |

**Response:**
```json
{ "success": true, "job_id": "uuid", "status": "processing" }
```

Server langsung respond tanpa menunggu print selesai. Cek status via `/api/queue`.

### `GET /api/printers`
Daftar printer yang tersedia di laptop.

### `GET /api/queue`
Semua print job (history + antrian).

### `POST /api/queue/retry`
Retry semua job yang gagal.

### `DELETE /api/queue/:id`
Hapus job dari antrian.

---

## Contoh: Integrasi dari Flutter

```dart
// Sesuai Technical Brief IM Scan
Future<PrintResult> printBadge(PrintData data) async {
  await _savePending(data);
  
  try {
    final res = await http.post(
      Uri.parse('http://192.168.1.10:3000/print'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'display_name': data.displayName,
        'name': data.fullName,
        'company': data.company,
        'department': data.department,
        'ticket_type': data.ticketType,
        'qr_code': data.qrCode,
        'badge_id': data.badgeId,
        'access': data.accessAreas,
      }),
    ).timeout(Duration(seconds: 3));
    
    final body = jsonDecode(res.body);
    if (body['success']) return PrintResult.success(via: 'local');
  } catch (_) {}
  
  // Fallback ke ngrok / queue
  return PrintResult.queued();
}
```

---

## Set IP Statis di Laptop (Wajib)

Agar IP laptop tidak berubah tiap connect WiFi:

**Windows:**
Control Panel → Network & Internet → Change adapter settings → klik kanan adapter → Properties → IPv4 → Use the following IP

```
IP Address:   192.168.1.10
Subnet Mask:  255.255.255.0
Gateway:      192.168.1.1
```

**Mac:**
System Settings → Network → [nama WiFi] → Details → TCP/IP → Configure IPv4: Manually

```
IP Address:   192.168.1.10
Subnet Mask:  255.255.255.0
Router:       192.168.1.1
```

> IP di atas hanya contoh. Sesuaikan dengan range IP jaringan venue (cek via `ipconfig` / `ifconfig`).

---

## Troubleshooting

**Server tidak bisa diakses dari tablet:**
- Pastikan laptop dan tablet di WiFi yang sama
- Cek firewall Windows: izinkan Node.js untuk jaringan private
  - Windows Defender Firewall → Allow an app → tambah `node.exe`
- Mac: System Settings → Privacy & Security → Firewall → pastikan tidak block incoming connections untuk Node

**Print gagal / tidak keluar:**
- Pastikan `PRINTER_NAME` di `.env` sesuai persis dengan nama printer
- Cek printer tidak dalam status "paused" di sistem
- Buka monitor UI → lihat error message di kolom antrian

**Badge tidak sesuai ukuran:**
- Set paper size di driver printer ke A6 (105×148mm) atau Custom 105×150mm
- Pastikan "fit to page" atau "actual size" saat print dialog muncul (jika ada)

**`npm install` gagal di Windows:**
- Jalankan command prompt sebagai Administrator
- Install [Windows Build Tools](https://www.npmjs.com/package/windows-build-tools): `npm install -g windows-build-tools`

---

## Menjalankan Otomatis saat Laptop Nyala (Opsional)

**Windows — buat Task Scheduler:**
1. Cari "Task Scheduler" di Start Menu
2. Create Task → trigger: "At startup"
3. Action: `node C:\im-print-server\src\server.js`

**Mac — buat Launch Agent:**
Buat file `~/Library/LaunchAgents/com.imscan.printserver.plist`, isi disesuaikan dengan path folder project.

---

## Struktur Project

```
im-scan-print-server/
├── src/
│   ├── server.js           ← Express server + semua route
│   ├── badge-generator.js  ← Generate PDF badge (HTML → Puppeteer)
│   ├── printer.js          ← Kirim PDF ke printer
│   ├── print-queue.js      ← Antrian dengan file JSON persistence
│   └── config.js           ← Baca konfigurasi dari .env
├── public/
│   └── index.html          ← Monitor UI (buka di browser)
├── queue/                  ← Auto-created: file antrian pending.json
├── temp/                   ← Auto-created: PDF sementara (langsung dihapus setelah print)
├── .env                    ← Konfigurasi (buat dari .env.example)
├── .env.example
└── package.json
```
