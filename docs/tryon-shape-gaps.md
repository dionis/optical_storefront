# Try-on · SKUs sin `shape`

**86 de 550 productos** (16%) no tienen el atributo `shape`, que es lo que decide la silueta de la lente
en el probador 3D ([frameGeometry.js](../apps/capri-storefront/src/components/tryon/frameGeometry.js)).
Sin él, todos caen en la misma silueta genérica `DEFAULT_SHAPE`.

> Generado por `apps/scraper/scripts/report_missing_shape.py`. Vuelve a
> ejecutarlo cuando cambie el catálogo.

## Por qué falta

**No es un fallo de extracción.** El proveedor sólo clasifica la forma de
464 de sus 578 productos: las facetas de `pa_shape` suman
exactamente esa cifra, y ninguno de los de abajo aparece en ninguna de ellas.
El dato no existe en origen, así que no hay nada que volver a scrapear.

## Cómo comprobarlo

Abre la ficha del producto de la tabla y busca la tabla de atributos: no hay
fila `Shape`. Para verlo en crudo, pega esto en el navegador cambiando el SKU:

```
https://caprioptics.com/wp-json/wc/store/v1/products?search=DC248
```

En `attributes` verás `Eye size`, `Bridge size`, `Material`… y ningún `Shape`.
Compáralo con un SKU que sí lo tenga para ver la diferencia.

## Resumen por causa

| Causa | SKUs | Qué hacer |
|---|---:|---|
| Sin clasificar en origen | 83 | Clasificar a ojo con la foto, o con el clasificador visual |
| No es montura | 3 | **Excluir del probador** — estuches, lectores, fit-overs y gafas de seguridad |

## Sin clasificar en origen (83)

| SKU | Nombre | Marca | Calibre | Puente | Style | B | Ficha | Foto |
|---|---|---|---|---|---|---|---|---|
| `MF90001` | MF90001 | Ago | 51-53 mm | 18-19 mm | Full frame | 41-50 mm | [ver](https://caprioptics.com/product/mf90001/) | [img](https://caprioptics.com/wp-content/uploads/MF90001%20C02.jpg) |
| `MF90007` | MF90007 | Ago | 48-50 mm | 20-22 mm | Full frame | 41-50 mm | [ver](https://caprioptics.com/product/mf90007/) | [img](https://caprioptics.com/wp-content/uploads/MF90007%20C03.jpg) |
| `MF90009` | MF90009 | Ago | 51-53 mm | 20-22 mm | Full frame | 41-50 mm | [ver](https://caprioptics.com/product/mf90009/) | [img](https://caprioptics.com/wp-content/uploads/MF90009%20C03.jpg) |
| `MF90011` | MF90011 | Ago | 48-50 mm | 18-19 mm | Full frame | 41-50 mm | [ver](https://caprioptics.com/product/mf90011/) | [img](https://caprioptics.com/wp-content/uploads/MF90011%20C01.jpg) |
| `PF80001` | PF80001 | Ago | 48-50 mm | 20-22 mm | Full frame | 41-50 mm | [ver](https://caprioptics.com/product/pf80001/) | [img](https://caprioptics.com/wp-content/uploads/PF80001%20C01.jpg) |
| `PF80007` | PF80007 | Ago | 51-53 mm | 23-24 mm | Full frame | 41-50 mm | [ver](https://caprioptics.com/product/pf80007/) | [img](https://caprioptics.com/wp-content/uploads/PF80007%20C01.jpg) |
| `DC243` | DC243 | Di Caprio | 48-50 mm | 20-22 mm | Full frame | 41-50 mm | [ver](https://caprioptics.com/product/dc243/) | [img](https://caprioptics.com/wp-content/uploads/DC243%20Black%20Antique%20Tortoise.jpg) |
| `DC244` | DC244 | Di Caprio | 54-56 mm | 16-17 mm | Full frame | 41-50 mm | [ver](https://caprioptics.com/product/dc244/) | [img](https://caprioptics.com/wp-content/uploads/DC244%20Black%20Gold.jpg) |
| `DC246` | DC246 | Di Caprio | 54-56 mm | 13-15 mm | Full frame | 41-50 mm | [ver](https://caprioptics.com/product/dc246/) | [img](https://caprioptics.com/wp-content/uploads/DC246%20Black.jpg) |
| `DC247` | DC247 | Di Caprio | 44-47 mm | 23-24 mm | Full frame | 31-40 mm | [ver](https://caprioptics.com/product/dc247/) | [img](https://caprioptics.com/wp-content/uploads/DC247%20Black.jpg) |
| `DC248` | DC248 | Di Caprio | 48-50 mm | 16-17 mm | — | 41-50 mm | [ver](https://caprioptics.com/product/dc248/) | [img](https://caprioptics.com/wp-content/uploads/DC248%20Blue.jpg) |
| `DC249` | DC249 | Di Caprio | 54-56 mm | 18-19 mm | Combo | — | [ver](https://caprioptics.com/product/dc249/) | [img](https://caprioptics.com/wp-content/uploads/DC249%20Black%20Tortoise.jpg) |
| `DC250` | DC250 | Di Caprio | 48-50 mm | 20-22 mm | Combo | — | [ver](https://caprioptics.com/product/dc250/) | [img](https://caprioptics.com/wp-content/uploads/DC250%20Black%20Gold.jpg) |
| `DC251` | DC251 | Di Caprio | 51-53 mm | 18-19 mm | Full frame | — | [ver](https://caprioptics.com/product/dc251/) | [img](https://caprioptics.com/wp-content/uploads/DC251%20Black.jpg) |
| `DC252` | DC252 | Di Caprio | 51-53 mm | 18-19 mm | Full frame | — | [ver](https://caprioptics.com/product/dc252/) | [img](https://caprioptics.com/wp-content/uploads/DC252%20Black.jpg) |
| `DC394` | DC394 | Di Caprio | 54-56 mm | 13-15 mm | Full frame | 31-40 mm | [ver](https://caprioptics.com/product/dc394/) | [img](https://caprioptics.com/wp-content/uploads/DC394%20Black.jpg) |
| `DC395` | DC395 | Di Caprio | 48-50 mm | 18-19 mm | Full frame | 41-50 mm | [ver](https://caprioptics.com/product/dc395/) | [img](https://caprioptics.com/wp-content/uploads/DC395%20Black%20Tortoise.jpg) |
| `DC396` | DC396 | Di Caprio | 51-53 mm | 16-17 mm | Combo | 41-50 mm | [ver](https://caprioptics.com/product/dc396/) | [img](https://caprioptics.com/wp-content/uploads/DC396%20Black.jpg) |
| `DC397` | DC397 | Di Caprio | 51-53 mm | 20-22 mm | Full frame | 41-50 mm | [ver](https://caprioptics.com/product/dc397/) | [img](https://caprioptics.com/wp-content/uploads/DC397%20Black.jpg) |
| `DC398` | DC398 | Di Caprio | 51-53 mm | 13-15 mm | Full frame | 41-50 mm | [ver](https://caprioptics.com/product/dc398/) | [img](https://caprioptics.com/wp-content/uploads/DC398%20Black%20Tortoise.jpg) |
| `DC399` | DC399 | Di Caprio | 51-53 mm | 20-22 mm | Full frame | 41-50 mm | [ver](https://caprioptics.com/product/dc399/) | [img](https://caprioptics.com/wp-content/uploads/DC399%20Black.jpg) |
| `DC406` | DC406 | Di Caprio | 54-56 mm | 18-19 mm | — | — | [ver](https://caprioptics.com/product/dc406/) | [img](https://caprioptics.com/wp-content/uploads/DC406%20Black.jpg) |
| `ISAAC` | ISAAC | Eyeleos | 51-53 mm | 16-17 mm | Full frame | — | [ver](https://caprioptics.com/product/isaac/) | [img](https://caprioptics.com/wp-content/uploads/Isaac%20Autumn%20Ice-S%20%281%29.jpg) |
| `MARSHA` | MARSHA | Eyeleos | 54-56 mm | 16-17 mm | Full frame | — | [ver](https://caprioptics.com/product/marsha/) | [img](https://caprioptics.com/wp-content/uploads/Marsha-Beehive%20%281%29.jpg) |
| `FX120` | FX120 | Flexure | 54-56 mm | 13-15 mm | Full frame | 41-50 mm | [ver](https://caprioptics.com/product/fx120/) | [img](https://caprioptics.com/wp-content/uploads/FX120%20Black.jpg) |
| `FX121` | FX121 | Flexure | 54-56 mm | 18-19 mm | Full frame | 41-50 mm | [ver](https://caprioptics.com/product/fx121/) | [img](https://caprioptics.com/wp-content/uploads/FX121%20Black.jpg) |
| `FX19` | FX19 | Flexure | 34-43 mm | 18-19 mm | Full frame | 20-30 mm | [ver](https://caprioptics.com/product/fx19/) | [img](https://caprioptics.com/wp-content/uploads/FX%2019%20COFFEE.jpg) |
| `U 35` | U 35 | Four You | 51-53 mm | 16-17 mm | Full frame | 20-30 mm | [ver](https://caprioptics.com/product/u-35/) | [img](https://caprioptics.com/wp-content/uploads/U35%20BLACK.jpg) |
| `UP 330` | UP 330 | Four You | 54-56 mm | 18-19 mm | Full frame | — | [ver](https://caprioptics.com/product/up-330/) | [img](https://caprioptics.com/wp-content/uploads/UP330%20Black.jpg) |
| `UP 331` | UP 331 | Four You | 54-56 mm | 16-17 mm | — | 41-50 mm | [ver](https://caprioptics.com/product/up-331/) | [img](https://caprioptics.com/wp-content/uploads/UP331%20Black.jpg) |
| `UP 332` | UP 332 | Four You | 54-56 mm | 16-17 mm | — | 41-50 mm | [ver](https://caprioptics.com/product/up-332/) | [img](https://caprioptics.com/wp-content/uploads/UP332%20Black.jpg) |
| `UP 333` | UP 333 | Four You | 54-56 mm | 18-19 mm | — | 41-50 mm | [ver](https://caprioptics.com/product/up-333/) | [img](https://caprioptics.com/wp-content/uploads/UP333%20Black%20Blue.jpg) |
| `US134` | US134 | Four You | 51-53 mm | 20-22 mm | Full frame | — | [ver](https://caprioptics.com/product/us134/) | [img](https://caprioptics.com/wp-content/uploads/US134%20Black.jpg) |
| `USTP5` | USTP5 | Four You | 54-56 mm | 18-19 mm | Full frame | 41-50 mm | [ver](https://caprioptics.com/product/ustp5/) | [img](https://caprioptics.com/wp-content/uploads/U211%20BLACK.jpg) |
| `GR 824` | GR 824 | Grande | 57-59 mm | 20-22 mm | Full frame | 41-50 mm | [ver](https://caprioptics.com/product/gr-824/) | [img](https://caprioptics.com/wp-content/uploads/GR%20824%20crystal.jpg) |
| `GR 829` | GR 829 | Grande | 57-59 mm | 18-19 mm | Combo | — | [ver](https://caprioptics.com/product/gr-829/) | [img](https://caprioptics.com/wp-content/uploads/GR829%20Black.jpg) |
| `EXTRA` | EXTRA | Millennial | 54-56 mm | 18-19 mm | Full frame | 51+ mm | [ver](https://caprioptics.com/product/extra/) | [img](https://caprioptics.com/wp-content/uploads/EXTRA%20Black%20Burgundy.jpg) |
| `FOMO` | FOMO | Millennial | 51-53 mm | 20-22 mm | Combo | 41-50 mm | [ver](https://caprioptics.com/product/fomo/) | [img](https://caprioptics.com/wp-content/uploads/FOMO%20Black%20Gold-scaled.jpg) |
| `GARY` | GARY | Millennial | 54-56 mm | 16-17 mm | Combo | 31-40 mm | [ver](https://caprioptics.com/product/gary/) | [img](https://caprioptics.com/wp-content/uploads/GARY%20black-scaled.jpg) |
| `JOYCE` | JOYCE | Millennial | 44-47 mm | 13-15 mm | Full frame | 20-30 mm | [ver](https://caprioptics.com/product/joyce/) | [img](https://caprioptics.com/wp-content/uploads/JOYCE%2051%20Brown.jpg) |
| `JUNIOR` | JUNIOR | Millennial | 34-43 mm | 16-17 mm | Full frame | 20-30 mm | [ver](https://caprioptics.com/product/junior/) | [img](https://caprioptics.com/wp-content/uploads/JUNIOR%20Black.jpg) |
| `ML 5` | ML 5 | Millennial | 54-56 mm | 16-17 mm | Combo | 41-50 mm | [ver](https://caprioptics.com/product/ml-5/) | [img](https://caprioptics.com/wp-content/uploads/ML5%20Black.jpg) |
| `ML 6` | ML 6 | Millennial | 54-56 mm | 16-17 mm | Full frame | 41-50 mm | [ver](https://caprioptics.com/product/ml-6/) | [img](https://caprioptics.com/wp-content/uploads/ML6%20Black.jpg) |
| `ML 7` | ML 7 | Millennial | 57-59 mm | 16-17 mm | Full frame | 51+ mm | [ver](https://caprioptics.com/product/ml-7/) | [img](https://caprioptics.com/wp-content/uploads/ML7%20Black.jpg) |
| `ML 8` | ML 8 | Millennial | 51-53 mm | 18-19 mm | Full frame | 41-50 mm | [ver](https://caprioptics.com/product/ml-8/) | [img](https://caprioptics.com/wp-content/uploads/ML8%20Black%20Clear.jpg) |
| `PERF` | PERF | Millennial | 54-56 mm | 16-17 mm | Combo | 41-50 mm | [ver](https://caprioptics.com/product/perf/) | [img](https://caprioptics.com/wp-content/uploads/PERF%20Black.jpg) |
| `PT 42` | PT 42 | Peachtree | 51-53 mm | 20-22 mm | Full frame | 31-40 mm | [ver](https://caprioptics.com/product/pt-42/) | [img](https://caprioptics.com/wp-content/uploads/PT%2042%20TORTOISE%20ANT%20GOLD.jpg) |
| `PT 70` | PT 70 | Peachtree | 48-50 mm | 18-19 mm | Full frame | 20-30 mm | [ver](https://caprioptics.com/product/pt-70/) | [img](https://caprioptics.com/wp-content/uploads/PT%2070%20BLACK.jpg) |
| `PT112` | PT112 | Peachtree | 51-53 mm | 16-17 mm | Full frame | 41-50 mm | [ver](https://caprioptics.com/product/pt112/) | [img](https://caprioptics.com/wp-content/uploads/PT112%20Burgundy.jpg) |
| `PT113` | PT113 | Peachtree | 51-53 mm | 16-17 mm | Full frame | 31-40 mm | [ver](https://caprioptics.com/product/pt113/) | [img](https://caprioptics.com/wp-content/uploads/PT113%20Gold.jpg) |
| `PT210` | PT210 | Peachtree | 54-56 mm | 16-17 mm | Full frame | 41-50 mm | [ver](https://caprioptics.com/product/pt210/) | [img](https://caprioptics.com/wp-content/uploads/PT210%20Black.jpg) |
| `PT212` | PT212 | Peachtree | 44-47 mm | 16-17 mm | Combo | — | [ver](https://caprioptics.com/product/pt212/) | [img](https://caprioptics.com/wp-content/uploads/PT212%20Green.jpg) |
| `SAFETY 65` | SAFETY 65 | ProRx | 57-59 mm | 16-17 mm | Full frame | 41-50 mm | [ver](https://caprioptics.com/product/safety-65/) | [img](https://caprioptics.com/wp-content/uploads/SAFETY%2065.jpg) |
| `SL101` | SL101 | Simplylite | 54-56 mm | 13-15 mm | Full frame | 41-50 mm | [ver](https://caprioptics.com/product/sl101/) | [img](https://caprioptics.com/wp-content/uploads/SL101%20Brown.jpg) |
| `SL102` | SL102 | Simplylite | 54-56 mm | 16-17 mm | Full frame | 31-40 mm | [ver](https://caprioptics.com/product/sl102/) | [img](https://caprioptics.com/wp-content/uploads/SL102%20Brown.jpg) |
| `SL104` | SL104 | Simplylite | 57-59 mm | 18-19 mm | Full frame | 41-50 mm | [ver](https://caprioptics.com/product/sl104/) | [img](https://caprioptics.com/wp-content/uploads/SL104%20Gold.jpg) |
| `SL105` | SL105 | Simplylite | 54-56 mm | 18-19 mm | Semi Rimless | 31-40 mm | [ver](https://caprioptics.com/product/sl105/) | [img](https://caprioptics.com/wp-content/uploads/SL105%20Blue.jpg) |
| `SL106` | SL106 | Simplylite | 54-56 mm | 16-17 mm | Semi Rimless | — | [ver](https://caprioptics.com/product/sl106/) | [img](https://caprioptics.com/wp-content/uploads/SL106%20Black.jpg) |
| `SL107` | SL107 | Simplylite | 54-56 mm | 18-19 mm | Semi Rimless | 31-40 mm | [ver](https://caprioptics.com/product/sl107/) | [img](https://caprioptics.com/wp-content/uploads/SL107%20Gunmetal.jpg) |
| `SL108` | SL108 | Simplylite | 51-53 mm | 16-17 mm | Full frame | 31-40 mm | [ver](https://caprioptics.com/product/sl108/) | [img](https://caprioptics.com/wp-content/uploads/SL108%20Gunmetal.jpg) |
| `SL110` | SL110 | Simplylite | 57-59 mm | 18-19 mm | Full frame | 31-40 mm | [ver](https://caprioptics.com/product/sl110/) | [img](https://caprioptics.com/wp-content/uploads/SL110%20Black.jpg) |
| `SL112` | SL112 | Simplylite | 48-50 mm | 16-17 mm | Full frame | 31-40 mm | [ver](https://caprioptics.com/product/sl112/) | [img](https://caprioptics.com/wp-content/uploads/SL112%20Gold.jpg) |
| `SL113` | SL113 | Simplylite | 51-53 mm | 16-17 mm | Full frame | — | [ver](https://caprioptics.com/product/sl113/) | [img](https://caprioptics.com/wp-content/uploads/SL113%20Black.jpg) |
| `SL114` | SL114 | Simplylite | 54-56 mm | 18-19 mm | Full frame | 41-50 mm | [ver](https://caprioptics.com/product/sl114/) | [img](https://caprioptics.com/wp-content/uploads/SL114%20Black.jpg) |
| `SL115` | SL115 | Simplylite | 51-53 mm | 16-17 mm | Semi Rimless | 31-40 mm | [ver](https://caprioptics.com/product/sl115/) | [img](https://caprioptics.com/wp-content/uploads/SL115%20Black.jpg) |
| `SL116` | SL116 | Simplylite | 48-50 mm | 18-19 mm | Semi Rimless | 41-50 mm | [ver](https://caprioptics.com/product/sl116/) | [img](https://caprioptics.com/wp-content/uploads/SL116%20Black.jpg) |
| `SLIMFOLD 1` | SLIMFOLD 1 | Slimfold | 44-47 mm | 20-22 mm | Full frame | — | [ver](https://caprioptics.com/product/slimfold-1/) | [img](https://caprioptics.com/wp-content/uploads/slim1-1.jpg) |
| `SLIMFOLD 3` | SLIMFOLD 3 | Slimfold | 44-47 mm | 20-22 mm | Full frame | — | [ver](https://caprioptics.com/product/slimfold-3/) | [img](https://caprioptics.com/wp-content/uploads/slim3.jpg) |
| `SLIMFOLD 5` | SLIMFOLD 5 | Slimfold | 51-53 mm | 20-22 mm | Full frame | — | [ver](https://caprioptics.com/product/slimfold-5/) | [img](https://caprioptics.com/wp-content/uploads/slim5.jpg) |
| `CS5134` | CS5134 | The Candy Shoppe | 51-53 mm | 18-19 mm | — | — | [ver](https://caprioptics.com/product/cs5134/) | [img](https://caprioptics.com/wp-content/uploads/CS5134%20C1.jpg) |
| `CS88937` | CS88937 | The Candy Shoppe | 51-53 mm | 16-17 mm | — | — | [ver](https://caprioptics.com/product/cs88937/) | [img](https://caprioptics.com/wp-content/uploads/CS88937%20C1.jpg) |
| `CS88945` | CS88945 | The Candy Shoppe | 51-53 mm | 16-17 mm | — | — | [ver](https://caprioptics.com/product/cs88945/) | [img](https://caprioptics.com/wp-content/uploads/CS88945%20C1.jpg) |
| `CS97278` | CS97278 | The Candy Shoppe | 48-50 mm | 18-19 mm | — | — | [ver](https://caprioptics.com/product/cs97278/) | [img](https://caprioptics.com/wp-content/uploads/CS97278%20C2.jpg) |
| `CSG018` | CSG018 | The Candy Shoppe | 51-53 mm | 16-17 mm | — | — | [ver](https://caprioptics.com/product/csg018/) | [img](https://caprioptics.com/wp-content/uploads/CSG018%20C1.jpg) |
| `CSG030` | CSG030 | The Candy Shoppe | 51-53 mm | 16-17 mm | — | — | [ver](https://caprioptics.com/product/csg030/) | [img](https://caprioptics.com/wp-content/uploads/CSG030%20C1.jpg) |
| `T 17` | T 17 | Trendy | 44-47 mm | 18-19 mm | Full frame | <21 mm | [ver](https://caprioptics.com/product/t-17/) | [img](https://caprioptics.com/wp-content/uploads/T17%20Pink.jpg) |
| `T 38` | T 38 | Trendy | 44-47 mm | 16-17 mm | — | — | [ver](https://caprioptics.com/product/t-38/) | [img](https://caprioptics.com/wp-content/uploads/T38%20Black%20Blue.jpg) |
| `T 39` | T 39 | Trendy | 34-43 mm | 16-17 mm | — | — | [ver](https://caprioptics.com/product/t-39/) | [img](https://caprioptics.com/wp-content/uploads/T39%20Green.jpg) |
| `VP 106` | VP 106 | Versailles Palace | 48-50 mm | 20-22 mm | Full frame | — | [ver](https://caprioptics.com/product/vp-106/) | [img](https://caprioptics.com/wp-content/uploads/VP%20106%20COFFEE.jpg) |
| `VP 113` | VP 113 | Versailles Palace | 44-47 mm | 18-19 mm | Semi Rimless | <21 mm | [ver](https://caprioptics.com/product/vp-113/) | [img](https://caprioptics.com/wp-content/uploads/VP%20113%20COFFEE.jpg) |
| `VP 18` | VP 18 | Versailles Palace | 34-43 mm | 18-19 mm | Full frame | 20-30 mm | [ver](https://caprioptics.com/product/vp-18/) | [img](https://caprioptics.com/wp-content/uploads/VP%2018%20COFFEE.jpg) |
| `VP 210` | VP 210 | Versailles Palace | 44-47 mm | 13-15 mm | Full frame | 20-30 mm | [ver](https://caprioptics.com/product/vp-210/) | [img](https://caprioptics.com/wp-content/uploads/VP%20210%20Brown.jpg) |
| `VP 29` | VP 29 | Versailles Palace | 34-43 mm | 18-19 mm | Full frame | <21 mm | [ver](https://caprioptics.com/product/vp-29/) | [img](https://caprioptics.com/wp-content/uploads/VP%2029%20COFFEE.jpg) |

## No es montura (3)

| SKU | Nombre | Marca | Calibre | Puente | Style | B | Ficha | Foto |
|---|---|---|---|---|---|---|---|---|
| `READ 2` | READ 2 | ProRx | — | — | Full frame | 31-40 mm | [ver](https://caprioptics.com/product/read-2/) | [img](https://caprioptics.com/wp-content/uploads/Read2.jpg) |
| `SAFETY 26` | SAFETY 26 | ProRx | — | — | Full frame | 41-50 mm | [ver](https://caprioptics.com/product/safety-26/) | [img](https://caprioptics.com/wp-content/uploads/SAFETY%2026.jpg) |
| `SLIMFOLD CASE 1-3` | SLIMFOLD CASE 1-3 | Slimfold | — | — | — | — | [ver](https://caprioptics.com/product/slimfold-case-1-3/) | [img](https://caprioptics.com/wp-content/uploads/SLIMFOLD%20CASE%201-3.jpg) |

