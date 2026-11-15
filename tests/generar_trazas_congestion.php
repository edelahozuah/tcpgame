<?php
declare(strict_types=1);

/*
 * Genera tests/trazas_congestion.json: las cartas del grupo «congestión» del
 * juego y sus trazas doradas, calculadas con el simulador de ejercicios de
 * secuencias TCP de la asignatura (ModeloTcp::simular), que es la fuente de
 * verdad del modelo.
 *
 * Uso:
 *   php tests/generar_trazas_congestion.php RUTA_DEL_SIMULADOR [--ver]
 *   PRACTICA_WEB=RUTA_DEL_SIMULADOR php tests/generar_trazas_congestion.php [--ver]
 *
 * RUTA_DEL_SIMULADOR es la raíz del proyecto del simulador (la que contiene
 * app/Secuencias/Tcp/cargar.php). Con --ver, además, escribe por pantalla un
 * resumen tic a tic de cada carta.
 *
 * Antes de nada comprueba que, con la misma traducción juego → simulador,
 * salen exactamente las tres trazas de tests/trazas_referencia.json (control
 * de flujo); si no, se para sin escribir nada.
 */

$args = array_values(array_filter(array_slice($argv, 1), static fn ($a) => $a !== '--ver'));
$ver = in_array('--ver', $argv, true);
$raiz = $args[0] ?? (getenv('PRACTICA_WEB') ?: null);
if ($raiz === null || !is_file($raiz . '/app/Secuencias/Tcp/cargar.php')) {
    fwrite(STDERR, "Uso: php tests/generar_trazas_congestion.php RUTA_DEL_SIMULADOR [--ver]\n"
        . "     (o la variable de entorno PRACTICA_WEB con esa ruta)\n");
    exit(2);
}
require $raiz . '/app/Secuencias/Tcp/cargar.php';

use App\Secuencias\Tcp\ModeloTcp;

const MSS = 64;
const SN_A = 1024;
const SN_B = 2048;
const W_A = 512;

/**
 * Escenario del juego → escenario del simulador.
 *  - Conexión ya abierta (sin apertura ni cierre); solo el cliente (A) envía
 *    `segmentos` × 64 B desde el tic 1; MSS 64 en los dos lados.
 *  - A empieza en SN 1024 y anuncia W = 512; B (servidor) empieza en 2048 y
 *    su búfer (`w`) es `bufer`.
 *  - Medio tic de propagación, ACK retardado un tic (CR3), B almacena lo que
 *    llega fuera de orden y A retransmite solo el más antiguo.
 *  - `lectura` = L del juego (la aplicación de B lee L tics después).
 *  - Pérdidas: el simulador numera los segmentos de datos por orden de primer
 *    envío; como A envía en orden de SN, el segmento del SN s es el
 *    (s − 1024)/64 + 1. El simulador no pierde ACK sin datos: `acks` tiene que
 *    estar vacío.
 *  - `cc` (null en las cartas de control de flujo): estado de partida del
 *    cliente con `congestion.lados.cliente` (VC, umbral y modo explícitos).
 *    El simulador aplica la congestión a los dos extremos; B no envía datos,
 *    así que en B no tiene efecto (solo aparece en los campos vc* de sus ACK).
 */
function aSimulador(array $j): array
{
    if (($j['perdidas']['acks'] ?? []) !== []) {
        throw new RuntimeException("{$j['id']}: el simulador no puede perder ACK");
    }
    $perdidas = [];
    foreach ($j['perdidas']['datos'] ?? [] as $d) {
        $perdidas[] = ['lado' => 'cliente', 'segmento' => intdiv($d['sn'] - SN_A, MSS) + 1, 'envio' => $d['envio']];
    }
    $cc = null;
    if (($j['cc'] ?? null) !== null) {
        $cc = [
            'umbral_mss' => $j['cc']['umbral'],
            'vc_inicial_mss' => 1,
            'lados' => ['cliente' => ['vc_mss' => $j['cc']['vc'], 'umbral_mss' => $j['cc']['umbral'], 'modo' => $j['cc']['modo']]],
        ];
    }
    return [
        'esc.familia' => 'SECUENCIAS_TCP',
        'esc.codigo' => 'TCPGame/' . $j['id'],
        'equipos' => [
            'cliente' => ['nombre' => 'A', 'mss' => MSS, 'w' => W_A, 'isn' => SN_A],
            'servidor' => ['nombre' => 'B', 'mss' => MSS, 'w' => $j['bufer'], 'isn' => SN_B],
        ],
        'tiempo' => ['propagacion' => 0.5, 'ack_retardado' => 1, 'rto' => $j['rto']],
        'politicas' => ['fuera_de_orden' => 'almacena', 'retransmite' => 'antiguo', 'lectura' => $j['L'], 'datos_en_ack_apertura' => false],
        'fases' => ['apertura' => false, 'cierre' => false, 'cierra' => 'cliente'],
        'envios' => [['lado' => 'cliente', 'octetos' => $j['segmentos'] * MSS, 'desde_tic' => 1]],
        'perdidas' => $perdidas,
        'congestion' => $cc,
        'http' => null,
        'modo' => 'dibujar',
        'campos' => $cc === null ? ['sn', 'an', 'flags', 'w', 'datos'] : ['sn', 'an', 'flags', 'w', 'datos', 'vc', 'modo_cc', 'umbral'],
        'nivel' => $cc === null ? 2 : 3,
    ];
}

/** Tic en que B envía el primer ACK que reconoce el fichero entero. */
function ticFinal(array $segmentos, array $j): ?int
{
    $fin = SN_A + $j['segmentos'] * MSS;
    foreach ($segmentos as $s) {
        if ($s['lado'] === 'servidor' && !$s['perdido'] && $s['an'] === $fin) {
            return $s['tic'];
        }
    }
    return null;
}

/** Lo que interesa del estado de cada lado al acabar cada tic. */
function estados(array $estados): array
{
    $r = [];
    foreach ($estados as $e) {
        $c = $e['cliente'];
        $s = $e['servidor'];
        $r[] = [
            'tic' => $e['tic'],
            'cliente' => [
                'vc' => $c['vc'], 'vc_valor' => $c['vc_valor'], 'vc_texto' => $c['vc_texto'],
                'umbral' => $c['umbral'], 'modo' => $c['modo'], 'dup_acks' => $c['dup_acks'],
                'sn_siguiente' => $c['sn_siguiente'], 'sin_confirmar' => $c['sin_confirmar'],
                'w_otro' => $c['w_otro'], 'vence' => $c['vence'],
            ],
            'servidor' => [
                'an_siguiente' => $s['an_siguiente'], 'w' => $s['w'], 'sin_leer' => $s['sin_leer'],
                'fuera_de_orden' => $s['fuera_de_orden'], 'ack_retardado' => $s['ack_retardado'], 'acks_debidos' => $s['acks_debidos'],
            ],
        ];
    }
    return $r;
}

// ---------------------------------------------------------------------------
// 1. Comprobación: las tres trazas de control de flujo de referencia.
// ---------------------------------------------------------------------------
$ref = json_decode(file_get_contents(__DIR__ . '/trazas_referencia.json'), true, 512, JSON_THROW_ON_ERROR)['apartados'];
$flujo = [
    'inmediata' => ['id' => 'N1', 'L' => 0],
    'lenta' => ['id' => 'N2', 'L' => 2],
    'cero' => ['id' => 'N3', 'L' => 8],
];
foreach ($flujo as $ap => $x) {
    $j = ['id' => $x['id'], 'L' => $x['L'], 'rto' => null, 'segmentos' => 6, 'bufer' => 256, 'perdidas' => ['datos' => [], 'acks' => []], 'cc' => null];
    $sim = ModeloTcp::simular(aSimulador($j));
    $a = json_encode($sim['segmentos']);
    $b = json_encode($ref[$ap]['segmentos']);
    if ($a !== $b) {
        fwrite(STDERR, "La traducción no reproduce la traza de referencia «{$ap}»:\n  simulador: {$a}\n  referencia: {$b}\n");
        exit(1);
    }
}
fwrite(STDERR, "Trazas de referencia de control de flujo (inmediata, lenta, cero): reproducidas segmento a segmento.\n");

// ---------------------------------------------------------------------------
// 2. Las cartas del grupo «congestión».
// ---------------------------------------------------------------------------
$SIN = ['datos' => [], 'acks' => []];
$cartas = [
    // GG3.4 · Arranque lento desde VC = 1; el umbral (16) no se alcanza.
    ['id' => 'C1', 'grupo' => 'congestion', 'nombre' => 'Conexión recién abierta, sin pérdidas',
     'L' => 0, 'rto' => 6, 'segmentos' => 8, 'bufer' => 1024, 'perdidas' => $SIN,
     'cc' => ['vc' => 1, 'umbral' => 16, 'modo' => 'AL']],
    // GG3.4 · AL → EC: con VC = 4 y umbral 5 llega un ACK de dos segmentos:
    // +1 hasta el umbral (5, EC) y el otro ya en EC → 5 + 1/5 (por tramos).
    ['id' => 'C2', 'grupo' => 'congestion', 'nombre' => 'Conexión recién abierta con un umbral bajo',
     'L' => 0, 'rto' => 6, 'segmentos' => 10, 'bufer' => 1024, 'perdidas' => $SIN,
     'cc' => ['vc' => 1, 'umbral' => 5, 'modo' => 'AL']],
    // GG3.4 · Se pierde el penúltimo segmento en AL: un solo ACK duplicado,
    // vence el temporizador con VC = 8 → umbral 4, VC = 1, AL; el ACK final
    // reconoce dos segmentos y la VC sube a 3, aún en AL.
    ['id' => 'C3', 'grupo' => 'congestion', 'nombre' => 'Se pierde un segmento en el arranque lento',
     'L' => 0, 'rto' => 3, 'segmentos' => 9, 'bufer' => 1024, 'perdidas' => ['datos' => [['sn' => 1472, 'envio' => 1]], 'acks' => []],
     'cc' => ['vc' => 1, 'umbral' => 16, 'modo' => 'AL']],
    // GG3.4 · La W de B (búfer de 256 B, lectura a los 4 tics) frena a A
    // mientras la VC sigue creciendo (VC 4 con W 128; VC 6 con W 64).
    ['id' => 'C4', 'grupo' => 'congestion', 'nombre' => 'Búfer pequeño y la aplicación de B lee despacio',
     'L' => 4, 'rto' => 6, 'segmentos' => 8, 'bufer' => 256, 'perdidas' => $SIN,
     'cc' => ['vc' => 1, 'umbral' => 16, 'modo' => 'AL']],
    // GG3.5 · EC con ACK acumulativos a mitad de conexión: 4, 4 + 2/4, 5,
    // 5 + 2/5, 5 + 4/5, 6 + 1/6.
    ['id' => 'C5', 'grupo' => 'congestion', 'nombre' => 'A mitad de conexión, sin pérdidas',
     'L' => 0, 'rto' => 6, 'segmentos' => 10, 'bufer' => 1024, 'perdidas' => $SIN,
     'cc' => ['vc' => 4, 'umbral' => 4, 'modo' => 'EC']],
    // GG3.5 · Se pierde el primero: tres ACK duplicados → umbral 4, VC 7, RR;
    // otro duplicado → 8; segmento nuevo en RR; ACK nuevo → VC 4, EC.
    ['id' => 'C6', 'grupo' => 'congestion', 'nombre' => 'A mitad de conexión, se pierde un segmento',
     'L' => 0, 'rto' => 6, 'segmentos' => 8, 'bufer' => 1024, 'perdidas' => ['datos' => [['sn' => 1024, 'envio' => 1]], 'acks' => []],
     'cc' => ['vc' => 8, 'umbral' => 6, 'modo' => 'EC']],
    // GG3.5 · Vence el temporizador en EC, sin pasar por RR: el temporizador
    // es corto y vence con un solo ACK duplicado → umbral = 4/2 = 2, VC = 1,
    // AL. El ACK que rellena el hueco reconoce 4 segmentos y cruza el umbral
    // por tramos (1 → 2 en AL, luego EC → 3 + 1/3).
    ['id' => 'C7', 'grupo' => 'congestion', 'nombre' => 'A mitad de conexión, se pierde un segmento y el temporizador es corto',
     'L' => 0, 'rto' => 4, 'segmentos' => 8, 'bufer' => 1024, 'perdidas' => ['datos' => [['sn' => 1024, 'envio' => 1]], 'acks' => []],
     'cc' => ['vc' => 4, 'umbral' => 4, 'modo' => 'EC']],
];

$salida = [];
foreach ($cartas as $j) {
    $esc = aSimulador($j);
    $sim = ModeloTcp::simular($esc);
    $fin = ticFinal($sim['segmentos'], $j);
    if ($fin === null) {
        fwrite(STDERR, "{$j['id']}: no hay ACK final\n");
        exit(1);
    }
    $salida[$j['id']] = ['juego' => $j, 'simulador' => $esc, 'segmentos' => $sim['segmentos'], 'estados' => estados($sim['estados']), 'fin' => $fin];
    if ($ver) {
        echo "== {$j['id']} {$j['nombre']} · fin {$fin}\n";
        foreach ($sim['segmentos'] as $s) {
            if ($s['lado'] === 'cliente') {
                printf("  %2d A SN %d%s%s  [%s] VC %-8s U %-5s %s\n", $s['tic'], $s['sn'], $s['retransmision'] ? ' retx' : '', $s['perdido'] ? ' X' : '', $s['causa'], $s['vc_texto'], $s['umbral'], $s['modo']);
            } else {
                printf("  %2d B AN %d W %d  [%s]\n", $s['tic'], $s['an'], $s['w'], $s['causa']);
            }
        }
        foreach ($sim['estados'] as $e) {
            $c = $e['cliente'];
            printf("     fin tic %2d: VC %-8s U %-5s %-2s dup %d sinconf %3d vence %s\n", $e['tic'], $c['vc_texto'], $c['umbral'], $c['modo'], $c['dup_acks'], $c['sin_confirmar'], $c['vence'] ?? '-');
        }
    }
}

$nota = 'Cartas del grupo «congestión» (Reno) y sus trazas doradas, calculadas con el simulador de ejercicios de secuencias TCP '
    . 'de la asignatura (ModeloTcp::simular) por tests/generar_trazas_congestion.php; no se editan a mano. '
    . '«juego»: la carta en el formato del motor (perdidas.datos por SN y número de envío; cc en MSS). '
    . '«simulador»: el escenario que se le pasa al simulador. '
    . '«segmentos»: la traza (cliente = A, servidor = B); vc, vc_valor, vc_texto, modo y umbral de un segmento son los del emisor '
    . 'al enviarlo: tras procesar los ACK que llegaron en el tic anterior y, si vence el temporizador en ese tic, ya con VC = 1. '
    . 'En los ACK de B salen también (el simulador aplica la congestión a los dos extremos), pero no significan nada. '
    . '«estados»: foto de cada lado AL ACABAR cada tic (tic 0 = de partida), es decir, ya con los segmentos enviados en ese tic '
    . 'entregados y procesados (lo que A verá al empezar el tic siguiente); vence = tic al comienzo del cual vencería el temporizador. '
    . '«fin»: tic en que B envía el ACK que reconoce el fichero entero.';
$json = json_encode(['nota' => $nota, 'apartados' => $salida], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
// Misma sangría (un espacio por nivel) que tests/trazas_referencia.json.
$json = preg_replace_callback('/^( +)/m', static fn ($m) => str_repeat(' ', intdiv(strlen($m[1]), 4)), $json);
file_put_contents(__DIR__ . '/trazas_congestion.json', $json . "\n");
fwrite(STDERR, 'Escrito tests/trazas_congestion.json: ' . implode(', ', array_map(static fn ($id, $a) => "{$id} (fin {$a['fin']})", array_keys($salida), $salida)) . "\n");
