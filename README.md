# TCPGame

Juego para aprender el **control de flujo y la transferencia fiable de TCP** jugando desde dentro de un extremo.
El alumno hace de cliente (emisor) o de servidor (receptor) y decide en cada tic **solo con lo que le ha llegado y lo que tiene apuntado en su hoja**, igual que TCP. Al final ve el diagrama completo y lo compara con lo que creía.

**Jugar:** <https://edelahozuah.github.io/tcpgame/>

Material docente sobre TCP (sesión GG33; Kurose y Ross, §3.5.3–3.5.6).

## Qué incluye

- **Escenarios de control de flujo** (N1–N3): la aplicación de B lee al momento, despacio o se duerme.
- **Escenarios con pérdidas** (P1–P5 y al azar): segmentos de datos o ACK perdidos, temporizador, ACK duplicados.
- **Opciones de la partida**: retransmisión rápida (tercer ACK duplicado) y qué hace B con lo que llega fuera de orden (lo guarda y A reenvía el más antiguo, o lo descarta y A reenvía toda la cola).
- **Corrección** tic a tic (práctica) o al final (evaluación), hoja de estado con las variables de Kurose (`UltimoByteEnviado`, `UltimoByteReconocido`, `VentRecepcion`…) y un resultado final según cómo quedó el fichero en B.
- **Reglamento en papel** para jugar en tríos (A, B y árbitro): [`Reglamento_TCPGame.md`](Reglamento_TCPGame.md).

El modelo de tics es el de los ejercicios de la asignatura: un segmento sale al comienzo del tic *t*, llega a mitad del tic *t* y el otro extremo lo tiene en cuenta en el tic *t* + 1.

## Estructura

| Ruta | Contenido |
|---|---|
| `web/` | El juego: página estática sin dependencias (`index.html`, `motor.js`, `juego.js`) |
| `tests/` | Pruebas del motor: `node tests/pruebas_motor.js` (contra las trazas de referencia de GG33 y casos de error típicos) |
| `Reglamento_TCPGame.md` | Reglas de la versión en papel |

Para probarlo en local basta con servir la carpeta `web/`, por ejemplo `python3 -m http.server -d web 8000` y abrir <http://localhost:8000>.

GitHub Pages se publica con la acción `.github/workflows/pages.yml`, que pasa las pruebas y despliega `web/` en cada push a `main`.

## Licencia

Código bajo licencia [MIT](LICENSE). Reglamento y textos didácticos bajo [CC BY 4.0](LICENSE-reglamento.md).
