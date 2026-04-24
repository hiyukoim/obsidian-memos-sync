import { Resource } from "@/api/memos-v0.22.0-adapter";

export type APIResource = {
	name?: string;
	externalLink?: string;
	type?: string;
	uid?: string;
	id: string;
	filename: string;
};

export function convert0220ResourceToAPIResource(
	resource: Resource
): APIResource {
	return {
		id: resource.name.replace(/^(resources|attachments)\//, ""),
		filename: resource.filename,
		externalLink: resource.externalLink,
		name: resource.name,
		type: resource.type,
		uid: resource.uid,
	};
}

export function generateResourceName(resource: APIResource): string {
	return `${resource.id}-${resource.filename.replace(/[/\\?%*:|"<>]/g, "-")}`;
}

export function generateResourceLink(resource: APIResource): string {
	if (resource.name) {
		// Server-managed attachment (may be served via externalLink / R2).
		// Always use a local wiki link — fetchResource downloads it via /file/.
		return `![[${generateResourceName(resource)}]]`;
	}
	// Truly external resource with no server identity — link to URL as-is.
	const prefix = resource.type?.includes("image") ? "!" : "";
	return `${prefix}[${resource.filename}](${resource.externalLink})`;
}
