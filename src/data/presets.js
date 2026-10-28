/* Container & Truck Load Planner — data/presets.js
 * Internal dimensions in cm, payload in kg. Values are typical approximations — every field is
 * editable in the UI (and can be saved as a custom preset).
 */
(function (root) {
  'use strict';
  var LP = root.LP = root.LP || {};

  LP.PRESETS = [
    // doorW / doorH = clear door opening (usually smaller than the inside); tare / maxGross = container
    // empty weight and max gross mass (for VGM); floorLoad = floor rating kg/m². Typical values — editable.
    { id: 'c20', group: 'container', name: "20' Standard", nameTh: "ตู้ 20' Standard", W: 235, L: 590, H: 239, maxPayload: 28000, cost: 0, doorW: 234, doorH: 228, tare: 2200, maxGross: 30480, floorLoad: 3000 },
    { id: 'c40', group: 'container', name: "40' Standard", nameTh: "ตู้ 40' Standard", W: 235, L: 1203, H: 239, maxPayload: 26500, cost: 0, doorW: 234, doorH: 228, tare: 3750, maxGross: 30480, floorLoad: 3000 },
    { id: 'c40hc', group: 'container', name: "40' High Cube", nameTh: "ตู้ 40' High Cube", W: 235, L: 1203, H: 269, maxPayload: 26500, cost: 0, doorW: 234, doorH: 258, tare: 3900, maxGross: 30480, floorLoad: 3000 },
    { id: 'c45hc', group: 'container', name: "45' High Cube", nameTh: "ตู้ 45' High Cube", W: 235, L: 1355, H: 269, maxPayload: 25500, cost: 0, doorW: 234, doorH: 258, tare: 4800, maxGross: 30480, floorLoad: 3000 },
    { id: 'rf20', group: 'container', name: "20' Reefer", nameTh: "ตู้เย็น 20' (Reefer)", W: 229, L: 544, H: 227, maxPayload: 27400, cost: 0, doorW: 229, doorH: 226, tare: 3000, maxGross: 30480, floorLoad: 3000 },
    { id: 'rf40', group: 'container', name: "40' Reefer HC", nameTh: "ตู้เย็น 40' HC (Reefer)", W: 229, L: 1158, H: 255, maxPayload: 29000, cost: 0, doorW: 229, doorH: 250, tare: 4800, maxGross: 34000, floorLoad: 3000 },
    { id: 'pk4', group: 'truck', name: 'Pickup box truck (4W)', nameTh: 'กระบะตู้ทึบ 4 ล้อ', W: 165, L: 270, H: 165, maxPayload: 1200, cost: 0, doorW: 155, doorH: 150, floorLoad: 1500 },
    // open pickup beds (no box): H = max load height above the bed floor (total height from the road − bed
    // height), bed.wallH = side wall, wheel arches = keep-out zones. No overhang past the tailgate.
    { id: 'pko1', group: 'truck', name: 'Open pickup, single cab', nameTh: 'กระบะเปิด ตอนเดียว', W: 152, L: 230, H: 170, maxPayload: 1100, cost: 0, floorLoad: 1200,
      bed: { wallH: 47, archW: 21, archL: 90, archH: 25, archY: 130, deck: 80, maxRoadH: 250 } },
    { id: 'pko2', group: 'truck', name: 'Open pickup, extended cab', nameTh: 'กระบะเปิด แค็บ', W: 152, L: 185, H: 170, maxPayload: 1000, cost: 0, floorLoad: 1200,
      bed: { wallH: 47, archW: 21, archL: 90, archH: 25, archY: 105, deck: 80, maxRoadH: 250 } },
    { id: 'pko4', group: 'truck', name: 'Open pickup, double cab', nameTh: 'กระบะเปิด 4 ประตู', W: 152, L: 152, H: 170, maxPayload: 950, cost: 0, floorLoad: 1200,
      bed: { wallH: 47, archW: 21, archL: 90, archH: 25, archY: 86, deck: 80, maxRoadH: 250 } },
    { id: 't4big', group: 'truck', name: 'Large 4W box truck', nameTh: 'รถ 4 ล้อใหญ่ตู้ทึบ', W: 200, L: 420, H: 200, maxPayload: 2500, cost: 0, doorW: 190, doorH: 185, floorLoad: 2000 },
    { id: 't6', group: 'truck', name: '6-wheel box truck', nameTh: 'รถ 6 ล้อตู้ทึบ', W: 230, L: 600, H: 230, maxPayload: 5500, cost: 0, doorW: 220, doorH: 215, floorLoad: 2500 },
    { id: 't10', group: 'truck', name: '10-wheel box truck', nameTh: 'รถ 10 ล้อตู้ทึบ', W: 240, L: 800, H: 240, maxPayload: 14500, cost: 0, doorW: 230, doorH: 225, floorLoad: 3000 }
  ];

  LP.PALETTE = ['#4e79a7', '#f28e2b', '#59a14f', '#e15759', '#76b7b2', '#edc948', '#b07aa1', '#ff9da7',
    '#9c755f', '#86bcb6', '#d37295', '#8cd17d', '#499894', '#f1ce63', '#a0cbe8', '#ffbe7d'];

  function item(o) {
    var d = {
      sku: '', name: '', color: null, w: 40, l: 30, h: 30, unit: 'cm', weight: 10, wunit: 'kg', qty: 10,
      maxMode: false, rotation: 'upright', stackable: true, maxStack: 0, maxLoad: 0, fragile: false,
      pkg: 'box', dropOrder: 1
    };
    for (var k in o) d[k] = o[k];
    return d;
  }

  LP.SAMPLES = [
    {
      id: 'ac1', name: "กล่อง 40×30×30 ซม. / 10 กก. ใส่ให้มากที่สุด (ตู้ 20')", nameEn: "40×30×30 cm / 10 kg cartons, max fill (20')",
      container: 'c20', objective: 'count',
      cargo: [item({ sku: 'CTN-4030', name: 'Carton 40x30x30', w: 40, l: 30, h: 30, weight: 10, maxMode: true, rotation: 'all' })]
    },
    {
      id: 'mixed', name: "สินค้าผสม พาเลท/ถัง/กล่อง (ตู้ 20')", nameEn: "Mixed pallets / drums / cartons (20')",
      container: 'c20', objective: 'volume',
      cargo: [
        item({ sku: 'PLT-EUR', name: 'Euro pallet', w: 80, l: 120, h: 120, weight: 450, qty: 6, pkg: 'pallet', stackable: false }),
        item({ sku: 'DRM-200', name: 'Drum 200L', w: 58, l: 58, h: 88, weight: 180, qty: 6, pkg: 'cylinder', maxStack: 2 }),
        item({ sku: 'BOX-L', name: 'Box large', w: 60, l: 40, h: 40, weight: 18, qty: 40, rotation: 'all' }),
        item({ sku: 'BOX-M', name: 'Box medium', w: 50, l: 30, h: 35, weight: 9, qty: 60, rotation: 'all' }),
        item({ sku: 'GLS-01', name: 'Glassware (fragile)', w: 45, l: 35, h: 30, weight: 6, qty: 20, fragile: true }),
        item({ sku: 'APP-TV', name: 'TV 55" upright', w: 20, l: 135, h: 85, weight: 22, qty: 12, rotation: 'upright', maxLoad: 30 })
      ]
    },
    {
      id: 'delivery', name: 'ส่ง 3 จุด เรียงตามลำดับลงของ (รถ 6 ล้อ)', nameEn: '3 drops, delivery order (6-wheel truck)',
      container: 't6', objective: 'delivery',
      cargo: [
        item({ sku: 'DROP1-A', name: 'Store A (drop 1)', w: 50, l: 40, h: 40, weight: 15, qty: 50, dropOrder: 1, rotation: 'all' }),
        item({ sku: 'DROP2-B', name: 'Store B (drop 2)', w: 60, l: 40, h: 30, weight: 12, qty: 60, dropOrder: 2, rotation: 'all' }),
        item({ sku: 'DROP3-C', name: 'Store C (drop 3)', w: 45, l: 45, h: 45, weight: 20, qty: 50, dropOrder: 3, rotation: 'all' })
      ]
    },
    {
      id: 'perf', name: "ทดสอบความเร็ว 600 ชิ้น 6 SKU (ตู้ 40')", nameEn: "Speed test: 600 items, 6 SKUs (40')",
      container: 'c40', objective: 'volume',
      cargo: [
        item({ sku: 'A-6040', w: 60, l: 40, h: 40, weight: 20, qty: 100, rotation: 'all' }),
        item({ sku: 'B-5030', w: 50, l: 30, h: 35, weight: 12, qty: 100, rotation: 'all' }),
        item({ sku: 'C-4545', w: 45, l: 45, h: 45, weight: 25, qty: 100, rotation: 'all' }),
        item({ sku: 'D-8060', w: 80, l: 60, h: 50, weight: 35, qty: 100, rotation: 'all' }),
        item({ sku: 'E-3525', w: 35, l: 25, h: 20, weight: 6, qty: 100, rotation: 'all' }),
        item({ sku: 'F-10050', w: 100, l: 50, h: 40, weight: 30, qty: 100 })
      ]
    },
    {
      id: 'drums', name: "ถัง ⌀50 ซม. เรียงสลับฟันปลา ซ้อน 2 ชั้น (ตู้ 20')", nameEn: "Ø50 cm drums, staggered, 2 tiers (20')",
      container: 'c20', objective: 'count',
      cargo: [item({ sku: 'DRM-50', name: 'Drum Ø50 cm', w: 50, l: 50, h: 88, weight: 150, qty: 104, pkg: 'cylinder', rotation: 'upright', maxStack: 2 })]
    },
    {
      id: 'pickupOpen', name: 'กล่องบนกระบะเปิด ตอนเดียว (สูงเกินผนัง ต้องรัด)', nameEn: 'Cartons on an open single-cab pickup (above the walls, strapped)',
      container: 'pko1', objective: 'volume',
      cargo: [
        item({ sku: 'CTN-5040', name: 'Carton 50x40x35', w: 50, l: 40, h: 35, weight: 14, qty: 36, rotation: 'all' }),
        item({ sku: 'SACK-25', name: 'Rice sack 25 kg', w: 40, l: 60, h: 15, weight: 25, qty: 10, rotation: 'upright' })
      ]
    },
    {
      id: 'big', name: "งานใหญ่ 3,000 กล่อง (ตู้ 40' HC)", nameEn: "Large job: 3,000 cartons (40' HC)",
      container: 'c40hc', objective: 'volume',
      cargo: [
        item({ sku: 'S-3020', name: 'Small carton', w: 30, l: 20, h: 20, weight: 4, qty: 1800, rotation: 'all' }),
        item({ sku: 'M-4030', name: 'Medium carton', w: 40, l: 30, h: 25, weight: 7, qty: 900, rotation: 'all' }),
        item({ sku: 'L-5040', name: 'Large carton', w: 50, l: 40, h: 30, weight: 11, qty: 300, rotation: 'all' })
      ]
    },
    {
      id: 'overweight', name: 'ของหนักเกินพิกัด (กระบะ 4 ล้อ)', nameEn: 'Overweight test (pickup 4W)',
      container: 'pk4', objective: 'volume',
      cargo: [item({ sku: 'STEEL-100', name: 'Steel parts 100 kg', w: 40, l: 40, h: 30, weight: 100, qty: 40, rotation: 'upright' })]
    }
  ];
  LP.newItem = item;
})(this);
