# Fútbol Internacional — plugin de Kino

Partidos de fútbol en vivo dentro de Kino: Champions League, Europa League, La Liga,
Premier League, Serie A, Bundesliga, Ligue 1 y las ligas de Sudamérica.

## Cómo se instala

1. Abre Kino y entra en **Plugins** (menú ☰ en el teléfono, Ajustes en la TV).
2. Toca **+** y escribe la dirección del repositorio:

   ```
   gregortt1/football-plugin
   ```

3. Acepta e instala.

Este repositorio **no está publicado en la tienda de Kino**: solo se instala escribiendo
la dirección de arriba.

## Qué muestra

- **En vivo ahora**: los partidos que se están jugando en este momento.
- **Todo el fútbol**: la agenda completa, ordenada por hora.
- Una fila por competición: Champions, Europa League, La Liga, Premier League, Serie A,
  Bundesliga, Ligue 1, Sudamérica y Más fútbol.
- La búsqueda funciona sobre la agenda del día (equipo, liga o ciudad).

Cada partido ofrece varias fuentes; el plugin prueba la primera que responda y devuelve
la señal que realmente está emitiendo.

## Estructura

```
kino-plugin.json   manifiesto (id, hosts, capacidades)
plugin.js          código del plugin (un solo archivo, sin dependencias)
icon.png           icono 96×96
```
