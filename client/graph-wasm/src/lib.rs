//! Graph-expression evaluator compiled to WASM; the fast path in front of mathjs.
//!
//! Compiles a normalized graph expression (the string `graph-parser.ts` hands
//! mathjs) into a postfix program once, then runs it per sample on a fixed
//! stack. Covers arithmetic, `^`, unary minus, `x`, `y`, `pi`, `e`, named
//! parameters and graph-parser.ts's built-in functions (min/max with two
//! arguments only); anything else fails to compile and `graph-wasm.ts` falls
//! back to mathjs. Rebuild with `npm run build:graph-wasm` in client/.
//!
//! No wasm-bindgen: JS passes strings through the shared input buffer.

use std::cell::UnsafeCell;

#[derive(Clone, Copy)]
enum Op {
    Const(f64),
    X,
    Y,
    Param(usize),
    Add,
    Sub,
    Mul,
    Div,
    Pow,
    Neg,
    Call1(fn(f64) -> f64),
    Call2(fn(f64, f64) -> f64),
}

const STACK: usize = 64;

struct Program {
    ops: Vec<Op>,
    params: Vec<f64>,
}

#[derive(Default)]
struct State {
    input: Vec<u8>,
    /// Parameter names for the next `compile`, in slot order.
    names: Vec<Vec<u8>>,
    programs: Vec<Option<Program>>,
}

struct Global(UnsafeCell<Option<State>>);
// SAFETY: wasm32-unknown-unknown without threads is single-threaded.
unsafe impl Sync for Global {}
static STATE: Global = Global(UnsafeCell::new(None));

fn state() -> &'static mut State {
    // SAFETY: single-threaded, and no export holds a borrow across another call.
    unsafe { (*STATE.0.get()).get_or_insert_with(State::default) }
}

/// Grow the input buffer to `len` bytes and return where JS should write them.
#[unsafe(no_mangle)]
pub extern "C" fn input_ptr(len: usize) -> *mut u8 {
    let s = state();
    s.input.resize(len, 0);
    s.input.as_mut_ptr()
}

/// Declare the name in the input buffer as the next parameter slot.
#[unsafe(no_mangle)]
pub extern "C" fn declare_param() {
    let s = state();
    s.names.push(s.input.clone());
}

/// Compile the expression in the input buffer against the declared
/// parameters. Returns a handle, or -1 when the expression is unsupported.
#[unsafe(no_mangle)]
pub extern "C" fn compile() -> i32 {
    let s = state();
    let names = std::mem::take(&mut s.names);
    let mut parser = Parser { src: &s.input, at: 0, names: &names, out: Vec::new() };
    let ok = parser.expr().is_some() && parser.peek().is_none() && max_depth(&parser.out) <= STACK;
    if !ok {
        return -1;
    }
    let program = Some(Program { ops: parser.out, params: vec![0.0; names.len()] });
    match s.programs.iter().position(Option::is_none) {
        Some(free) => {
            s.programs[free] = program;
            free as i32
        }
        None => {
            s.programs.push(program);
            s.programs.len() as i32 - 1
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn set_param(handle: usize, slot: usize, value: f64) {
    if let Some(Some(program)) = state().programs.get_mut(handle) {
        if let Some(param) = program.params.get_mut(slot) {
            *param = value;
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn eval(handle: usize, x: f64, y: f64) -> f64 {
    match state().programs.get(handle) {
        Some(Some(program)) => run(&program.ops, &program.params, x, y),
        _ => f64::NAN,
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn release(handle: usize) {
    if let Some(slot) = state().programs.get_mut(handle) {
        *slot = None;
    }
}

#[inline(always)]
fn run(program: &[Op], params: &[f64], x: f64, y: f64) -> f64 {
    if program.is_empty() {
        return f64::NAN;
    }
    let mut stack = [0.0f64; STACK];
    let mut top = 0usize;
    for op in program {
        match *op {
            Op::Const(v) => {
                stack[top] = v;
                top += 1;
            }
            Op::X => {
                stack[top] = x;
                top += 1;
            }
            Op::Y => {
                stack[top] = y;
                top += 1;
            }
            Op::Param(i) => {
                stack[top] = params[i];
                top += 1;
            }
            Op::Neg => stack[top - 1] = -stack[top - 1],
            Op::Call1(f) => stack[top - 1] = f(stack[top - 1]),
            Op::Add | Op::Sub | Op::Mul | Op::Div | Op::Pow | Op::Call2(_) => {
                top -= 1;
                let (a, b) = (stack[top - 1], stack[top]);
                stack[top - 1] = match *op {
                    Op::Add => a + b,
                    Op::Sub => a - b,
                    Op::Mul => a * b,
                    Op::Div => a / b,
                    Op::Pow => pow(a, b),
                    Op::Call2(f) => f(a, b),
                    _ => unreachable!(),
                };
            }
        }
    }
    stack[0]
}

/// `powf`, with integer exponents through `powi` the way JS `**` stays exact.
fn pow(a: f64, b: f64) -> f64 {
    if b == b.trunc() && b.abs() <= 64.0 {
        a.powi(b as i32)
    } else {
        a.powf(b)
    }
}

fn max_depth(program: &[Op]) -> usize {
    let (mut depth, mut max) = (0usize, 0usize);
    for op in program {
        match op {
            Op::Const(_) | Op::X | Op::Y | Op::Param(_) => depth += 1,
            Op::Neg | Op::Call1(_) => {}
            _ => depth = depth.saturating_sub(1),
        }
        max = max.max(depth);
    }
    max
}

fn function1(name: &[u8]) -> Option<fn(f64) -> f64> {
    Some(match name {
        b"sin" => f64::sin,
        b"cos" => f64::cos,
        b"tan" => f64::tan,
        b"asin" => f64::asin,
        b"acos" => f64::acos,
        b"atan" => f64::atan,
        b"sinh" => f64::sinh,
        b"cosh" => f64::cosh,
        b"tanh" => f64::tanh,
        b"sqrt" => f64::sqrt,
        b"cbrt" => f64::cbrt,
        b"abs" => f64::abs,
        b"exp" => f64::exp,
        b"sec" => |v: f64| 1.0 / v.cos(),
        b"csc" => |v: f64| 1.0 / v.sin(),
        b"cot" => |v: f64| 1.0 / v.tan(),
        b"log" => f64::ln,
        b"floor" => f64::floor,
        b"ceil" => f64::ceil,
        // Half away from zero, like mathjs's toFixed-based round.
        b"round" => f64::round,
        b"sign" => |v: f64| if v > 0.0 { 1.0 } else if v < 0.0 { -1.0 } else { v },
        _ => return None,
    })
}

fn function2(name: &[u8]) -> Option<fn(f64, f64) -> f64> {
    Some(match name {
        b"log" => |v: f64, base: f64| v.ln() / base.ln(),
        b"min" => f64::min,
        b"max" => f64::max,
        // mathjs's: the sign of the divisor, and `mod(x, 0)` is x.
        b"mod" => |a: f64, b: f64| if b == 0.0 { a } else { a - b * (a / b).floor() },
        _ => return None,
    })
}

/// Recursive descent with mathjs precedence: `-x^2` is `-(x^2)`, `^` is right
/// associative and its exponent may carry a sign (`2^-1`).
struct Parser<'a> {
    src: &'a [u8],
    at: usize,
    names: &'a [Vec<u8>],
    out: Vec<Op>,
}

impl Parser<'_> {
    fn peek(&mut self) -> Option<u8> {
        while self.src.get(self.at) == Some(&b' ') {
            self.at += 1;
        }
        self.src.get(self.at).copied()
    }

    fn eat(&mut self, c: u8) -> bool {
        let hit = self.peek() == Some(c);
        if hit {
            self.at += 1;
        }
        hit
    }

    fn expr(&mut self) -> Option<()> {
        self.term()?;
        loop {
            if self.eat(b'+') {
                self.term()?;
                self.out.push(Op::Add);
            } else if self.eat(b'-') {
                self.term()?;
                self.out.push(Op::Sub);
            } else {
                return Some(());
            }
        }
    }

    fn term(&mut self) -> Option<()> {
        self.unary()?;
        loop {
            if self.eat(b'*') {
                self.unary()?;
                self.out.push(Op::Mul);
            } else if self.eat(b'/') {
                self.unary()?;
                self.out.push(Op::Div);
            } else {
                return Some(());
            }
        }
    }

    fn unary(&mut self) -> Option<()> {
        if self.eat(b'-') {
            self.unary()?;
            self.out.push(Op::Neg);
            Some(())
        } else if self.eat(b'+') {
            self.unary()
        } else {
            self.power()
        }
    }

    fn power(&mut self) -> Option<()> {
        self.primary()?;
        if self.eat(b'^') {
            self.unary()?;
            self.out.push(Op::Pow);
        }
        Some(())
    }

    fn primary(&mut self) -> Option<()> {
        let c = self.peek()?;
        if self.eat(b'(') {
            self.expr()?;
            return self.eat(b')').then_some(());
        }
        if c.is_ascii_digit() || c == b'.' {
            let start = self.at;
            while self.src.get(self.at).is_some_and(|b| b.is_ascii_digit() || *b == b'.') {
                self.at += 1;
            }
            if matches!(self.src.get(self.at), Some(b'e' | b'E'))
                && self.src.get(self.at + 1).is_some_and(|b| b.is_ascii_digit() || *b == b'-' || *b == b'+')
            {
                self.at += 2;
                while self.src.get(self.at).is_some_and(u8::is_ascii_digit) {
                    self.at += 1;
                }
            }
            let text = std::str::from_utf8(&self.src[start..self.at]).ok()?;
            self.out.push(Op::Const(text.parse().ok()?));
            return Some(());
        }
        if !c.is_ascii_alphabetic() {
            return None;
        }
        let start = self.at;
        while self.src.get(self.at).is_some_and(|b| b.is_ascii_alphanumeric() || *b == b'_') {
            self.at += 1;
        }
        let name = &self.src[start..self.at];
        if self.eat(b'(') {
            self.expr()?;
            if self.eat(b',') {
                self.expr()?;
                self.out.push(Op::Call2(function2(name)?));
            } else {
                self.out.push(Op::Call1(function1(name)?));
            }
            return self.eat(b')').then_some(());
        }
        self.out.push(match name {
            b"x" => Op::X,
            b"y" => Op::Y,
            b"pi" => Op::Const(std::f64::consts::PI),
            b"e" => Op::Const(std::f64::consts::E),
            _ => Op::Param(self.names.iter().position(|n| n == name)?),
        });
        Some(())
    }
}
