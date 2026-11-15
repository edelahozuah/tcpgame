// node tests/pruebas_doradas_congestion.js  — el motor contra las trazas doradas del simulador (cartas C1–C7).
// Las trazas (tests/trazas_congestion.json) las calcula el simulador de ejercicios de la asignatura; no se editan a mano.
'use strict';
const path = require('path');
const fs = require('fs');
const { Partida, ESCENARIOS, CC } = require('../web/motor.js');

let fallos = 0;
const ok = (cond, msg) => { if (!cond) { fallos++; console.log('  FALLO:', msg); } };
const cerca = (a, b) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-9;

const apartados = JSON.parse(fs.readFileSync(path.join(__dirname, 'trazas_congestion.json'), 'utf8')).apartados;

// Única discrepancia conocida con el simulador: en RR o con c fraccionario él escribe una fracción reducida («2 + 1/4») y
// el motor un decimal («2,25»). El texto solo se compara en AL/EC con c entero; el valor, siempre.
const cEntero = (s) => s.modo !== 'RR' && (!s.vc || Number.isInteger(s.vc.c));

for (const [id, ap] of Object.entries(apartados)) {
  // 1. La carta del juego es la del JSON
  const { ref, ...carta } = ESCENARIOS[id] || {};
  ok(!!ESCENARIOS[id], `${id}: no está en ESCENARIOS`);
  ok(JSON.stringify(carta) === JSON.stringify(ap.juego), `${id}: ESCENARIOS no coincide con el JSON\n    motor: ${JSON.stringify(carta)}\n    JSON:  ${JSON.stringify(ap.juego)}`);
  ok(ref === ap.fin, `${id}: ref ${ref}, esperado ${ap.fin}`);

  // 2. Motor contra simulador, segmento a segmento
  const p = Partida.simular(ap.juego);
  const nuestro = p.registro.map((s) => [s.tic, s.lado === 'A' ? 'cliente' : 'servidor', s.sn, s.an, s.w, s.datos, !!s.perdido, !!s.retx].join(' '));
  const dorado = ap.segmentos.map((s) => [s.tic, s.lado, s.sn, s.an, s.w, s.datos, s.perdido, s.retransmision].join(' '));
  console.log(`${id}: ${nuestro.length} segmentos, fin en el tic ${p.fin.tic} (simulador ${ap.fin})`);
  ok(JSON.stringify(nuestro) === JSON.stringify(dorado), `${id} no coincide con la traza\n    nuestro: ${nuestro.join(' | ')}\n    dorado:  ${dorado.join(' | ')}`);
  ap.segmentos.forEach((d, n) => {
    const s = p.registro[n];
    if (!s || d.lado !== 'cliente') return;
    const t = `${id} tic ${d.tic} SN ${d.sn}`;
    ok(cerca(s.vc, d.vc_valor), `${t}: VC ${s.vc}, esperado ${d.vc_valor}`);
    ok(s.modo === d.modo, `${t}: modo ${s.modo}, esperado ${d.modo}`);
    ok(cerca(s.umbral, d.umbral), `${t}: umbral ${s.umbral}, esperado ${d.umbral}`);
    if (cEntero(d)) ok(s.vcTexto === d.vc_texto, `${t}: texto «${s.vcTexto}», esperado «${d.vc_texto}»`);
    else ok(s.vcTexto === CC.texto(CC.crear({ vc: d.vc_valor, umbral: d.umbral, modo: d.modo })), `${t}: texto «${s.vcTexto}»`);
  });
  ok(p.fin.tic === ap.fin && p.fin.motivo === 'completo', `${id}: fin ${JSON.stringify(p.fin)}, esperado tic ${ap.fin}`);

  // 3. Un jugador que imita al motor (hoja = foto completa, acción = decisionTCP) lo tiene todo bien, en A y en B
  for (const rol of ['A', 'B']) {
    const q = new Partida(ap.juego, rol);
    while (q.empezarTic()) {
      const f = q.historia[q.historia.length - 1].foto[rol];
      const ev = q.cerrarTic(q.decisionTCP(rol).accion, f);
      ok(ev.ok, `${id}/${rol} tic ${q.tic}: ${JSON.stringify(ev)}`);
      if (rol === 'A') ok(['vc', 'umbral', 'modo'].every((k) => ev.campos.some((c) => c.campo === k)), `${id}/A tic ${q.tic}: faltan los campos de congestión`);
    }
    ok(q.fin.tic === ap.fin && q.fin.motivo === 'completo', `${id}/${rol} imitando al motor: fin ${JSON.stringify(q.fin)}`);
  }
}

console.log(fallos ? `\n${fallos} fallo(s)` : '\nTodo bien');
process.exit(fallos ? 1 : 0);
