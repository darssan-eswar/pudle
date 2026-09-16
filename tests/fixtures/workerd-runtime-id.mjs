import { createRuntimeId } from '../../src/server/runtime-id.mjs';

const worker = {
  fetch() {
    return Response.json({ id: createRuntimeId() });
  },
};

export default worker;
