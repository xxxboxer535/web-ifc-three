import { IdAttrName, JSONObject } from '../BaseDefinitions';
import { Node, IfcState, PropsNames, pName } from '../BaseDefinitions';
import { IfcElements } from './IFCElementsMap';
import { IFCPROJECT, Vector } from 'web-ifc';
import { BufferGeometry } from 'three';
import { IfcTypesMap } from './IfcTypesMap';

/**
 * Contains the logic to get the properties of the items within an IFC model.
 */
export class PropertyManager {
    private state: IfcState;

    constructor(state: IfcState) {
        this.state = state;
    }

    getExpressId(geometry: BufferGeometry, faceIndex: number) {
        if (!geometry.index) return;
        const geoIndex = geometry.index.array;
        return geometry.attributes[IdAttrName].getX(geoIndex[3 * faceIndex]);
    }

    async getItemProperties(modelID: number, id: number, recursive = false) {
        return this.state.useJSON ?
            { ...this.state.models[modelID].jsonData[id] } :
            this.state.api.GetLine(modelID, id, recursive);
    }

    async getAllItemsOfType(modelID: number, type: number, verbose: boolean) {
        return this.state.useJSON ?
            this.getAllItemsOfTypeJSON(modelID, type, verbose) :
            this.getAllItemsOfTypeWebIfcAPI(modelID, type, verbose);
    }

    async getPropertySets(modelID: number, elementID: number, recursive = false) {
        return this.state.useJSON ?
            this.getPropertyJSON(modelID, elementID, recursive, PropsNames.psets) :
            this.getPropertyWebIfcAPI(modelID, elementID, recursive, PropsNames.psets);
    }

    async getTypeProperties(modelID: number, elementID: number, recursive = false) {
        return this.state.useJSON ?
            this.getPropertyJSON(modelID, elementID, recursive, PropsNames.type) :
            this.getPropertyWebIfcAPI(modelID, elementID, recursive, PropsNames.type);
    }

    async getMaterialsProperties(modelID: number, elementID: number, recursive = false) {
        return this.state.useJSON ?
            this.getPropertyJSON(modelID, elementID, recursive, PropsNames.materials) :
            this.getPropertyWebIfcAPI(modelID, elementID, recursive, PropsNames.materials);
    }

    async getSpatialStructure(modelID: number, includeProperties?: boolean) {
        if (!this.state.useJSON && includeProperties) {
            console.warn('Including properties in getSpatialStructure with the JSON workflow disabled can lead to poor performance.');
        }

        return this.state.useJSON ?
            this.getSpatialStructureJSON(modelID, includeProperties) :
            this.getSpatialStructureWebIfcAPI(modelID, includeProperties);
    }

    private async getSpatialStructureJSON(modelID: number, includeProperties?: boolean) {
        const chunks = await this.getSpatialTreeChunks(modelID);
        const projectID = this.getAllItemsOfTypeJSON(modelID, IFCPROJECT, false)[0];
        const project = PropertyManager.newIfcProject(projectID);
        this.getSpatialNode(modelID, project, chunks, includeProperties);
        return { ...project };
    }

    private async getSpatialStructureWebIfcAPI(modelID: number, includeProperties?: boolean) {
        const chunks = await this.getSpatialTreeChunks(modelID);
        const allLines = await this.state.api.GetLineIDsWithType(modelID, IFCPROJECT);
        const projectID = allLines.get(0);
        const project = PropertyManager.newIfcProject(projectID);
        this.getSpatialNode(modelID, project, chunks, includeProperties);
        return project;
    }

    private getAllItemsOfTypeJSON(modelID: number, type: number, verbose: boolean) {
        const data = this.state.models[modelID].jsonData;
        const typeName = IfcTypesMap[type];
        if (!typeName) {
            throw new Error(`Type not found: ${type}`);
        }
        return this.filterJSONItemsByType(data, typeName, verbose);
    }

    private filterJSONItemsByType(data: { [id: number]: JSONObject }, typeName: string, verbose: boolean) {
        const result: any[] = [];
        Object.keys(data).forEach(key => {
            const numKey = parseInt(key);
            if (data[numKey].type.toUpperCase() === typeName) {
                result.push(verbose ? { ...data[numKey] } : numKey);
            }
        });
        return result;
    }

    private getItemsByIDJSON(modelID: number, ids: number[]) {
        const data = this.state.models[modelID].jsonData;
        const result: any[] = [];
        ids.forEach(id => result.push({ ...data[id] }));
        return result;
    }

    private getPropertyJSON(modelID: number, elementID: number, recursive = false, propName: pName) {
        const resultIDs = this.getAllRelatedItemsOfTypeJSON(modelID, elementID, propName);
        const result = this.getItemsByIDJSON(modelID, resultIDs);
        if (recursive) {
            result.forEach(result => this.getJSONReferencesRecursively(modelID, result));
        }
        return result;
    }

    private getJSONReferencesRecursively(modelID: number, jsonObject: any) {
        if (jsonObject == undefined) return;
        const keys = Object.keys(jsonObject);
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            this.getJSONItem(modelID, jsonObject, key);
        }
    }

    private getJSONItem(modelID: number, jsonObject: any, key: string) {
        if (Array.isArray(jsonObject[key])) {
            return this.getMultipleJSONItems(modelID, jsonObject, key);
        }
        if (jsonObject[key] && jsonObject[key].type === 5) {
            jsonObject[key] = this.getItemsByIDJSON(modelID, [jsonObject[key].value])[0];
            this.getJSONReferencesRecursively(modelID, jsonObject[key]);
        }
    }

    private getMultipleJSONItems(modelID: number, jsonObject: any, key: string) {
        jsonObject[key] = jsonObject[key].map((item: any) => {
            if (item.type === 5) {
                item = this.getItemsByIDJSON(modelID, [item.value])[0];
                this.getJSONReferencesRecursively(modelID, item);
            }
            return item;
        });
    }

    private async getPropertyWebIfcAPI(modelID: number, elementID: number, recursive = false, propName: pName) {
        const propSetIds = await this.getAllRelatedItemsOfTypeWebIfcAPI(modelID, elementID, propName);
        const result: any[] = [];
        for(let i = 0; i < propSetIds.length; i++) {
            result.push(await this.state.api.GetLine(modelID, propSetIds[i], recursive));
        }
        return result;
    }

    private async getAllItemsOfTypeWebIfcAPI(modelID: number, type: number, verbose: boolean) {
        let items: number[] = [];
        const lines = await this.state.api.GetLineIDsWithType(modelID, type);
        for (let i = 0; i < lines.size(); i++) items.push(lines.get(i));
        if (!verbose) return items;
        const result: any[] = [];
        for (let i = 0; i < items.length; i++) {
            result.push(await this.state.api.GetLine(modelID, items[i]));
        }
        return result;
    }

    private async getSpatialTreeChunks(modelID: number) {
        const treeChunks: any = {};
        const json = this.state.useJSON;
        if (json) {
            this.getChunksJSON(modelID, treeChunks, PropsNames.aggregates);
            this.getChunksJSON(modelID, treeChunks, PropsNames.spatial);
        } else {
            await this.getChunksWebIfcAPI(modelID, treeChunks, PropsNames.aggregates);
            await this.getChunksWebIfcAPI(modelID, treeChunks, PropsNames.spatial);
        }
        return treeChunks;
    }

    private getChunksJSON(modelID: number, chunks: any, propNames: pName) {
        const relation = this.getAllItemsOfTypeJSON(modelID, propNames.name, true);
        relation.forEach(rel => {
            this.saveChunk(chunks, propNames, rel);
        });
    }

    private async getChunksWebIfcAPI(modelID: number, chunks: any, propNames: pName) {
        const relation = await this.state.api.GetLineIDsWithType(modelID, propNames.name);
        for (let i = 0; i < relation.size(); i++) {
            const rel = await this.state.api.GetLine(modelID, relation.get(i), false);
            this.saveChunk(chunks, propNames, rel);
        }
    }

    private saveChunk(chunks: any, propNames: pName, rel: any) {
        const relating = rel[propNames.relating].value;
        const related = rel[propNames.related].map((r: any) => r.value);
        if (chunks[relating] == undefined) {
            chunks[relating] = related;
        } else {
            chunks[relating] = chunks[relating].concat(related);
        }
    }

    private getSpatialNode(modelID: number, node: Node, treeChunks: any, includeProperties?: boolean) {
        this.getChildren(modelID, node, treeChunks, PropsNames.aggregates, includeProperties);
        this.getChildren(modelID, node, treeChunks, PropsNames.spatial, includeProperties);
    }

    private getChildren(modelID: number, node: Node, treeChunks: any, propNames: pName, includeProperties?: boolean) {
        const children = treeChunks[node.expressID];
        if (children == undefined) return;
        const prop = propNames.key as keyof Node;
        (node[prop] as Node[]) = children.map((child: number) => {
            let node = this.newNode(modelID, child);
            if (includeProperties) {
                const properties = this.getItemProperties(modelID, node.expressID);
                node = { ...node, ...properties };
            }
            this.getSpatialNode(modelID, node, treeChunks, includeProperties);
            return node;
        });
    }

    private newNode(modelID: number, id: number) {
        const typeName = this.getNodeType(modelID, id);
        return {
            expressID: id,
            type: typeName,
            children: []
        };
    }

    private getNodeType(modelID: number, id: number) {
        if (this.state.useJSON) return this.state.models[modelID].jsonData[id].type;
        const typeID = this.state.models[modelID].types[id];
        return IfcElements[typeID];
    }

    private getAllRelatedItemsOfTypeJSON(modelID: number, id: number, propNames: pName) {
        const lines = this.getAllItemsOfTypeJSON(modelID, propNames.name, true);
        const IDs: number[] = [];
        lines.forEach(line => {
            const isRelated = PropertyManager.isRelated(id, line, propNames);
            if (isRelated) this.getRelated(line, propNames, IDs);
        });
        return IDs;
    }

    private async getAllRelatedItemsOfTypeWebIfcAPI(modelID: number, id: number, propNames: pName) {
        const lines = await this.state.api.GetLineIDsWithType(modelID, propNames.name);
        const IDs: number[] = [];
        for (let i = 0; i < lines.size(); i++) {
            const rel = await this.state.api.GetLine(modelID, lines.get(i));
            const isRelated = PropertyManager.isRelated(id, rel, propNames);
            if (isRelated) this.getRelated(rel, propNames, IDs);
        }
        return IDs;
    }

    private getRelated(rel: any, propNames: pName, IDs: number[]) {
        const element = rel[propNames.relating];
        if (!Array.isArray(element)) IDs.push(element.value);
        else element.forEach((ele) => IDs.push(ele.value));
    }

    private static isRelated(id: number, rel: any, propNames: pName) {
        const relatedItems = rel[propNames.related];
        if (Array.isArray(relatedItems)) {
            const values = relatedItems.map((item) => item.value);
            return values.includes(id);
        }
        return relatedItems.value === id;
    }

    private static newIfcProject(id: number) {
        return {
            expressID: id,
            type: 'IFCPROJECT',
            children: []
        };
    }
}
