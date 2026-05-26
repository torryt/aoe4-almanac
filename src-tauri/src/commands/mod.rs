pub mod civs;
pub mod me;
pub mod games;
pub mod notes;
pub mod opponents;
pub mod stats;
pub mod sync;
pub mod aoe4world;

// Re-export commands flat for the invoke_handler! macro.
pub use civs::*;
pub use me::*;
pub use games::*;
pub use notes::*;
pub use opponents::*;
pub use stats::*;
pub use sync::*;
pub use aoe4world::*;
