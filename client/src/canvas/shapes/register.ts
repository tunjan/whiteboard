// Registers all shape implementations. Importing this module (once) populates
// the shape registry. Adding a shape = add its util and one line here.
import { shapeRegistry } from './shape-registry';
import { drawUtil } from './draw';
import { rectangleUtil } from './rectangle';
import { ellipseUtil } from './ellipse';
import { polygonUtil } from './polygon';
import { lineUtil } from './line';
import { arrowUtil } from './arrow';
import { textUtil } from './text';
import { imageUtil } from './image';
import { graphUtil } from './graph';
import { groupUtil } from './group';
import { frameUtil } from './frame';

shapeRegistry.register(drawUtil);
shapeRegistry.register(rectangleUtil);
shapeRegistry.register(ellipseUtil);
shapeRegistry.register(polygonUtil);
shapeRegistry.register(lineUtil);
shapeRegistry.register(arrowUtil);
shapeRegistry.register(textUtil);
shapeRegistry.register(imageUtil);
shapeRegistry.register(graphUtil);
shapeRegistry.register(groupUtil);
shapeRegistry.register(frameUtil);
