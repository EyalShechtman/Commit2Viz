// Random test code - not related to the main project

// Simple number guessing game
function randomNumberGame() {
    const secretNumber = Math.floor(Math.random() * 100) + 1;
    let attempts = 0;

    console.log("I'm thinking of a number between 1 and 100!");

    function makeGuess(guess) {
        attempts++;
        if (guess === secretNumber) {
            return `Correct! It took ${attempts} attempts.`;
        } else if (guess < secretNumber) {
            return "Too low! Try again.";
        } else {
            return "Too high! Try again.";
        }
    }

    return makeGuess;
}

// Random array operations
class ArrayManipulator {
    constructor() {
        this.data = [];
    }

    addRandomElements(count) {
        for (let i = 0; i < count; i++) {
            this.data.push(Math.random() * 1000);
        }
    }

    shuffleArray() {
        for (let i = this.data.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.data[i], this.data[j]] = [this.data[j], this.data[i]];
        }
        return this.data;
    }

    getStats() {
        if (this.data.length === 0) return null;

        const sum = this.data.reduce((a, b) => a + b, 0);
        const avg = sum / this.data.length;
        const max = Math.max(...this.data);
        const min = Math.min(...this.data);

        return { avg, max, min, sum };
    }
}

// Random string generator
function generateRandomString(length = 10) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let result = '';

    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    return result;
}

// Fibonacci generator
function* fibonacciGenerator() {
    let prev = 0;
    let curr = 1;

    while (true) {
        yield curr;
        [prev, curr] = [curr, prev + curr];
    }
}

// Random color generator
function getRandomColor(format = 'hex') {
    const r = Math.floor(Math.random() * 256);
    const g = Math.floor(Math.random() * 256);
    const b = Math.floor(Math.random() * 256);

    switch(format) {
        case 'hex':
            return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
        case 'rgb':
            return `rgb(${r}, ${g}, ${b})`;
        case 'array':
            return [r, g, b];
        default:
            return { r, g, b };
    }
}

// Test execution
console.log("Random test file loaded!");
console.log("Random string:", generateRandomString(15));
console.log("Random color:", getRandomColor());

const arrayTest = new ArrayManipulator();
arrayTest.addRandomElements(5);
console.log("Random array:", arrayTest.data);
console.log("Array stats:", arrayTest.getStats());

const fib = fibonacciGenerator();
console.log("First 10 Fibonacci numbers:");
for (let i = 0; i < 10; i++) {
    console.log(fib.next().value);
}