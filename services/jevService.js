// Replace only this function body when connecting a real JEV model.
// Input legalMoves are server-generated: { id, san, from, to, promotion }.
export async function selectMove({ fen, legalMoves }) {
  if (typeof fen !== 'string' || legalMoves.length === 0) {
    throw new Error('Mock JEV requires a position and legal moves.');
  }
  await new Promise((resolve) => setTimeout(resolve, 400));
  const move = legalMoves[Math.floor(Math.random() * legalMoves.length)];
  return {
    selectedMoveId: move.id,
    candidates: legalMoves.map(({ id, san }) => ({
      moveId: id,
      san,
      probability: 1 / legalMoves.length
    }))
  };
}
