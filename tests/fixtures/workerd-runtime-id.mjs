import { createRuntimeId } from '../../server/runtime-id.mjs';

const worker = {
  fetch() {
    return Response.json({ id: createRuntimeId() });
  },
};

export default worker;
