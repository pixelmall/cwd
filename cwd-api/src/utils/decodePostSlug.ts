export function decodePostSlug(slug: string): string {
	if (!slug) return slug;
	let decoded = slug.trim();
	let prev = '';
	while (prev !== decoded) {
		prev = decoded;
		try {
			decoded = decodeURIComponent(decoded);
		} catch {
			break;
		}
	}
	return decoded;
}

export function getAllSlugFormats(slug: string): string[] {
	if (!slug) return [];
	const decoded = decodePostSlug(slug);
	const formats = new Set<string>();
	
	formats.add(decoded);
	
	if (decoded !== slug) {
		formats.add(slug);
	}
	
	const encoded = encodeURI(decoded);
	if (encoded !== decoded && !formats.has(encoded)) {
		formats.add(encoded);
	}
	
	return Array.from(formats);
}

export function escapeLikePattern(str: string): string {
	return str.replace(/[%_]/g, '|$&');
}
