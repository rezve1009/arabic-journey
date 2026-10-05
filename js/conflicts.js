// Keep recognizing old responses and queued errors during rolling updates.
export const isRevisionConflict=error=>['PT409','40001'].includes(error?.code);
