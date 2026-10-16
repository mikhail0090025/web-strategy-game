const canvas = document.getElementById("mapCanvas");
const ctx = canvas.getContext("2d");

const mapSizeSelect = document.getElementById("mapSize");
const countryCountInput = document.getElementById("countryCount");
const generateButton = document.getElementById("generateButton");
const legend = document.getElementById("legend");

let currentMode = "terrain";

let world = null;


// ============================================================
// CONFIG
// ============================================================

const MAP_SIZES = {
    small: {
        width: 50,
        height: 35
    },

    medium: {
        width: 80,
        height: 55
    },

    large: {
        width: 110,
        height: 75
    }
};


// ============================================================
// SEEDED RANDOM
// ============================================================

class Random {
    constructor(seed) {
        this.seed = seed;
    }

    next() {
        this.seed = (this.seed * 1664525 + 1013904223) % 4294967296;
        return this.seed / 4294967296;
    }

    int(min, max) {
        return Math.floor(this.next() * (max - min + 1)) + min;
    }
}


// ============================================================
// VALUE NOISE
// ============================================================

class Noise {
    constructor(seed) {
        this.random = new Random(seed);
        this.grid = new Map();
    }

    randomValue(x, y) {
        const key = `${x},${y}`;

        if (!this.grid.has(key)) {
            this.grid.set(key, this.random.next());
        }

        return this.grid.get(key);
    }

    smooth(t) {
        return t * t * (3 - 2 * t);
    }

    interpolate(a, b, t) {
        t = this.smooth(t);
        return a + (b - a) * t;
    }

    get(x, y, scale) {
        x /= scale;
        y /= scale;

        const x0 = Math.floor(x);
        const y0 = Math.floor(y);

        const x1 = x0 + 1;
        const y1 = y0 + 1;

        const sx = x - x0;
        const sy = y - y0;

        const n00 = this.randomValue(x0, y0);
        const n10 = this.randomValue(x1, y0);
        const n01 = this.randomValue(x0, y1);
        const n11 = this.randomValue(x1, y1);

        const ix0 = this.interpolate(n00, n10, sx);
        const ix1 = this.interpolate(n01, n11, sx);

        return this.interpolate(ix0, ix1, sy);
    }

    fractal(x, y, scale, octaves = 4) {
        let value = 0;
        let amplitude = 1;
        let frequency = 1;
        let totalAmplitude = 0;

        for (let i = 0; i < octaves; i++) {
            value += this.get(
                x * frequency,
                y * frequency,
                scale
            ) * amplitude;

            totalAmplitude += amplitude;

            amplitude *= 0.5;
            frequency *= 2;
        }

        return value / totalAmplitude;
    }
}


// ============================================================
// PROVINCE
// ============================================================

class Province {
    constructor(x, y) {
        this.x = x;
        this.y = y;

        this.height = 0;
        this.moisture = 0;

        this.terrain = "water";

        this.country = -1;
        this.neighbors = [];
    }
}


// ============================================================
// WORLD
// ============================================================

class World {
    constructor(width, height, countryCount, seed) {
        this.width = width;
        this.height = height;
        this.countryCount = countryCount;
        this.seed = seed;

        this.provinces = [];

        this.heightNoise = new Noise(seed);
        this.moistureNoise = new Noise(seed + 1000);

        this.countries = [];

        this.generate();
    }

    generate() {
        this.createGrid();
        this.generateTerrain();
        this.generateCountries();
    }

    createGrid() {
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                this.provinces.push(
                    new Province(x, y)
                );
            }
        }

        for (const province of this.provinces) {
            province.neighbors =
                this.getNeighbors(province.x, province.y);
        }
    }

    getProvince(x, y) {
        if (
            x < 0 ||
            y < 0 ||
            x >= this.width ||
            y >= this.height
        ) {
            return null;
        }

        return this.provinces[
            y * this.width + x
        ];
    }

    getNeighbors(x, y) {
        const even = y % 2 === 0;

        const directionsEven = [
            [1, 0],
            [-1, 0],
            [0, -1],
            [-1, -1],
            [0, 1],
            [-1, 1]
        ];

        const directionsOdd = [
            [1, 0],
            [-1, 0],
            [1, -1],
            [0, -1],
            [1, 1],
            [0, 1]
        ];

        const directions =
            even ? directionsEven : directionsOdd;

        const neighbors = [];

        for (const [dx, dy] of directions) {
            const province = this.getProvince(
                x + dx,
                y + dy
            );

            if (province) {
                neighbors.push(province);
            }
        }

        return neighbors;
    }

    generateTerrain() {
        for (const province of this.provinces) {

            let nx = province.x;
            let ny = province.y;

            let height =
                this.heightNoise.fractal(
                    nx,
                    ny,
                    18,
                    5
                );

            let moisture =
                this.moistureNoise.fractal(
                    nx + 300,
                    ny + 300,
                    22,
                    4
                );

            province.height = height;
            province.moisture = moisture;

            // Water
            if (height < 0.38) {
                province.terrain = "water";
            }

            // Surface
            else if (height < 0.63) {

                if (moisture > 0.67) {
                    province.terrain = "swamp";
                }

                else if (moisture > 0.43) {
                    province.terrain = "forest";
                }

                else {
                    province.terrain = "plain";
                }
            }

            // Hills
            else if (height < 0.78) {
                province.terrain = "hills";
            }

            // Mountains
            else {
                province.terrain = "mountains";
            }
        }
    }

    generateCountries() {

        const random =
            new Random(this.seed + 5000);

        const land =
            this.provinces.filter(
                p => p.terrain !== "water"
            );

        if (land.length === 0) {
            return;
        }

        const actualCount =
            Math.min(
                this.countryCount,
                land.length
            );

        // ----------------------------------------------------
        // Choose country capitals / starting provinces
        // ----------------------------------------------------

        const centers = [];

        let attempts = 0;

        while (
            centers.length < actualCount &&
            attempts < 10000
        ) {
            attempts++;

            const candidate =
                land[random.int(0, land.length - 1)];

            let valid = true;

            for (const center of centers) {

                const dx =
                    candidate.x - center.x;

                const dy =
                    candidate.y - center.y;

                const distance =
                    Math.sqrt(dx * dx + dy * dy);

                if (distance < 7) {
                    valid = false;
                    break;
                }
            }

            if (valid) {
                centers.push(candidate);
            }
        }

        // ----------------------------------------------------
        // Create countries
        // ----------------------------------------------------

        for (let i = 0; i < centers.length; i++) {

            this.countries.push({
                id: i,
                color: this.randomCountryColor(random),
                center: centers[i]
            });

            centers[i].country = i;
        }

        // ----------------------------------------------------
        // Region growing
        // ----------------------------------------------------

        let unclaimed =
            land.filter(
                p => p.country === -1
            );

        let safety = 0;

        while (
            unclaimed.length > 0 &&
            safety < land.length * 10
        ) {

            safety++;

            let progress = false;

            for (const province of [...unclaimed]) {

                const possibleCountries = [];

                for (const neighbor of province.neighbors) {

                    if (
                        neighbor.country !== -1 &&
                        neighbor.terrain !== "water"
                    ) {
                        possibleCountries.push(
                            neighbor.country
                        );
                    }
                }

                if (possibleCountries.length > 0) {

                    // Prefer a country bordering this province
                    const country =
                        possibleCountries[
                            random.int(
                                0,
                                possibleCountries.length - 1
                            )
                        ];

                    province.country = country;

                    progress = true;
                }
            }

            if (!progress) {
                break;
            }

            unclaimed =
                land.filter(
                    p => p.country === -1
                );
        }

        // ----------------------------------------------------
        // Assign any remaining isolated provinces
        // ----------------------------------------------------

        for (const province of land) {

            if (province.country !== -1) {
                continue;
            }

            let nearestCountry = 0;
            let nearestDistance = Infinity;

            for (const country of this.countries) {

                const dx =
                    province.x -
                    country.center.x;

                const dy =
                    province.y -
                    country.center.y;

                const distance =
                    dx * dx + dy * dy;

                if (distance < nearestDistance) {
                    nearestDistance = distance;
                    nearestCountry = country.id;
                }
            }

            province.country = nearestCountry;
        }
    }

    randomCountryColor(random) {

        const hue =
            random.int(0, 359);

        const saturation =
            random.int(55, 75);

        const lightness =
            random.int(40, 58);

        return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
    }
}


// ============================================================
// RENDERER
// ============================================================

class Renderer {

    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");
    }

    render(world, mode) {

        const container =
            document.getElementById("mapContainer");

        const availableWidth =
            container.clientWidth - 30;

        const availableHeight =
            container.clientHeight - 30;

        const hexWidth = 18;
        const hexHeight = 20;

        const mapWidth =
            world.width * hexWidth * 0.75 + hexWidth;

        const mapHeight =
            world.height * hexHeight + hexHeight / 2;

        const scale =
            Math.min(
                availableWidth / mapWidth,
                availableHeight / mapHeight
            );

        this.canvas.width =
            mapWidth * scale;

        this.canvas.height =
            mapHeight * scale;

        this.ctx.setTransform(
            scale,
            0,
            0,
            scale,
            0,
            0
        );

        this.ctx.clearRect(
            0,
            0,
            mapWidth,
            mapHeight
        );

        for (const province of world.provinces) {
            this.drawProvince(
                province,
                mode,
                world
            );
        }

        this.drawBorders(world);
    }

    getHexCenter(province) {

        const size = 12;

        const width =
            Math.sqrt(3) * size;

        const horizontal =
            width;

        const vertical =
            size * 1.5;

        const x =
            province.x * horizontal +
            (province.y % 2) *
            (horizontal / 2) +
            width;

        const y =
            province.y * vertical +
            size;

        return { x, y, size };
    }

    drawProvince(province, mode, world) {

        const {
            x,
            y,
            size
        } = this.getHexCenter(province);

        let color;

        if (mode === "terrain") {
            color =
                this.terrainColor(
                    province
                );
        }

        else {
            if (province.terrain === "water") {
                color = "#164b70";
            } else {
                color =
                    world.countries[
                        province.country
                    ]?.color || "#777";
            }
        }

        this.ctx.beginPath();

        for (let i = 0; i < 6; i++) {

            const angle =
                Math.PI / 3 * i +
                Math.PI / 6;

            const px =
                x + size * Math.cos(angle);

            const py =
                y + size * Math.sin(angle);

            if (i === 0) {
                this.ctx.moveTo(px, py);
            } else {
                this.ctx.lineTo(px, py);
            }
        }

        this.ctx.closePath();

        this.ctx.fillStyle = color;
        this.ctx.fill();
    }

    terrainColor(province) {

        switch (province.terrain) {

            case "water":
                return "#18527a";

            case "plain":
                return "#72a85b";

            case "forest":
                return "#28633d";

            case "swamp":
                return "#536b4c";

            case "hills":
                return "#9c8d59";

            case "mountains":
                return "#8b8b8b";

            default:
                return "#ff00ff";
        }
    }

    drawBorders(world) {

        this.ctx.strokeStyle =
            "rgba(0, 0, 0, 0.25)";

        this.ctx.lineWidth = 0.7;

        for (const province of world.provinces) {

            const {
                x,
                y,
                size
            } = this.getHexCenter(province);

            for (const neighbor of province.neighbors) {

                if (
                    neighbor.country === province.country
                ) {
                    continue;
                }

                const {
                    x: nx,
                    y: ny
                } = this.getHexCenter(neighbor);

                this.ctx.beginPath();

                this.ctx.moveTo(
                    (x + nx) / 2,
                    (y + ny) / 2
                );

                this.ctx.lineTo(
                    x,
                    y
                );

                this.ctx.stroke();
            }
        }
    }
}


// ============================================================
// LEGEND
// ============================================================

function updateLegend(mode) {

    if (mode === "terrain") {

        legend.innerHTML = `
            <div class="legend-item">
                <span class="legend-color" style="background:#18527a"></span>
                Вода
            </div>

            <div class="legend-item">
                <span class="legend-color" style="background:#72a85b"></span>
                Равнина
            </div>

            <div class="legend-item">
                <span class="legend-color" style="background:#536b4c"></span>
                Болото
            </div>

            <div class="legend-item">
                <span class="legend-color" style="background:#28633d"></span>
                Лес
            </div>

            <div class="legend-item">
                <span class="legend-color" style="background:#9c8d59"></span>
                Холмы
            </div>

            <div class="legend-item">
                <span class="legend-color" style="background:#8b8b8b"></span>
                Горы
            </div>
        `;

    } else {

        legend.innerHTML = `
            <div>Режим: страны</div>
            <div>Каждый цвет = отдельное государство</div>
        `;
    }
}


// ============================================================
// GENERATION
// ============================================================

function generateWorld() {

    const size =
        MAP_SIZES[
            mapSizeSelect.value
        ];

    let countryCount =
        Number(countryCountInput.value);

    countryCount =
        Math.max(
            2,
            Math.min(
                countryCount,
                100
            )
        );

    const seed =
        Math.floor(
            Math.random() * 1000000000
        );

    world =
        new World(
            size.width,
            size.height,
            countryCount,
            seed
        );

    renderer.render(
        world,
        currentMode
    );

    updateLegend(currentMode);

    console.log("World generated:", {
        width: size.width,
        height: size.height,
        countries: countryCount,
        seed
    });
}


// ============================================================
// EVENTS
// ============================================================

const renderer =
    new Renderer(canvas);

generateButton.addEventListener(
    "click",
    generateWorld
);

document
    .querySelectorAll(".mode")
    .forEach(button => {

        button.addEventListener(
            "click",
            () => {

                document
                    .querySelectorAll(".mode")
                    .forEach(
                        b => b.classList.remove("active")
                    );

                button.classList.add("active");

                currentMode =
                    button.dataset.mode;

                renderer.render(
                    world,
                    currentMode
                );

                updateLegend(
                    currentMode
                );
            }
        );
    });

window.addEventListener(
    "resize",
    () => {

        if (world) {
            renderer.render(
                world,
                currentMode
            );
        }
    }
);


// ============================================================
// INITIAL WORLD
// ============================================================

generateWorld();