// กำหนด URL ของ Back-end API พอร์ตใหม่
const API_URL = 'http://localhost:5001/api';

// -------------------------------------------------------------
// 1. ดึงรายการวัตถุดิบทั้งหมดจาก PostgreSQL มาแสดงในตาราง
// -------------------------------------------------------------
async function loadInventory() {
  try {
    const response = await fetch(`${API_URL}/inventory`);
    if (!response.ok) throw new Error('Network response was not ok');
    
    const items = await response.json();
    renderInventoryTable(items);
  } catch (error) {
    console.error('Error loading inventory:', error);
    alert('ไม่สามารถโหลดข้อมูลสต๊อกได้ กรุณาตรวจสอบการเชื่อมต่อ Back-end');
  }
}

// ฟังก์ชันวาด HTML ตารางแสดงรายการวัตถุดิบ
function renderInventoryTable(items) {
  const tableBody = document.getElementById('inventory-table-body'); // เปลี่ยน ID ตาม HTML ของคุณ
  if (!tableBody) return;

  tableBody.innerHTML = ''; // ล้างข้อมูลเก่า

  items.forEach(item => {
    // เช็คเตือนสต๊อกต่ำ
    const isLowStock = parseFloat(item.remaining_qty) <= parseFloat(item.min_threshold);
    const rowClass = isLowStock ? 'table-danger' : '';

    const row = `
      <tr class="${rowClass}">
        <td><strong>${item.item_code}</strong></td>
        <td>${item.name}</td>
        <td>${item.category_name || '-'}</td>
        <td>${item.remaining_qty} ${item.unit}</td>
        <td>${item.unit_cost} บาท</td>
        <td>
          ${isLowStock ? '<span class="badge bg-danger">สต๊อกต่ำ</span>' : '<span class="badge bg-success">ปกติ</span>'}
        </td>
        <td>
          <button class="btn btn-sm btn-primary" onclick="openStockModal(${item.id}, '${item.name}')">ปรับสต๊อก</button>
        </td>
      </tr>
    `;
    tableBody.insertAdjacentHTML('beforeend', row);
  });
}

// -------------------------------------------------------------
// 2. ส่งข้อมูลการ รับเข้า / เบิกออก / ปรับยอดสต๊อก ไปยัง API
// -------------------------------------------------------------
async function submitStockMovement(itemId, type, qty, note = '') {
  try {
    const response = await fetch(`${API_URL}/stock/movement`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        item_id: itemId,
        type: type,       // 'IN' (รับเข้า), 'OUT' (ใช้ไป/ของเสีย), 'ADJUST' (ปรับนับจริง)
        qty: parseFloat(qty),
        user_id: 1,       // Default Admin User
        note: note
      })
    });

    const result = await response.json();

    if (response.ok) {
      alert('บันทึกข้อมูลสต๊อกเรียบร้อยแล้ว!');
      loadInventory(); // รีโหลดตารางใหม่ทันทีเพื่ออัปเดตยอดคงเหลือล่าสุด
    } else {
      alert('เกิดข้อผิดพลาด: ' + result.error);
    }
  } catch (error) {
    console.error('Error updating stock:', error);
    alert('ไม่สามารถบันทึกข้อมูลได้');
  }
}

// สั่งให้โหลดข้อมูลสต๊อกทันทีเมื่อเปิดหน้าเว็บ
document.addEventListener('DOMContentLoaded', () => {
  loadInventory();
});