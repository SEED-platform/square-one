#!/usr/bin/env python3
"""
Additional analysis to verify building type completeness and find 
missing combinations that would be most impactful for matching.
"""

import csv
import os
from collections import defaultdict, Counter

def analyze_building_types_in_files():
    """Analyze what building types actually exist in the files vs our enums."""
    
    # Files are now in the same directory as this script
    category_file = os.path.join(os.path.dirname(__file__), 'energystar_site_eui_by_category.csv')
    subcategory_file = os.path.join(os.path.dirname(__file__), 'energystar_site_eui_by_subcategory.csv')
    
    # Our current enums
    building_types_enum = {
        'All', 'Banking/financial services', 'Education', 'Entertainment/public assembly',
        'Food sales and service', 'Healthcare', 'Lodging/residential', 'Manufacturing/industrial',
        'Office', 'Other', 'Public services', 'Religious worship', 'Retail', 'Services',
        'Technology/science', 'Utility', 'Warehouse/storage'
    }
    
    building_subtypes_enum = {
        'Personal Services (Health/Beauty', 'All', 'Bank Branch', 'College/University',
        'Convenience Store without Gas Station', 'Courthouse', 'Distribution Center',
        'Fast Food Restaurant', 'Financial Office', 'Fire Station', 'Fitness Center/Health Club/Gym',
        'Food Sales', 'Food Service', 'Laboratory', 'Library', 'Manufacturing/Industrial Plant',
        'Medical Office', 'Movie Theater', 'Non-Refrigerated Warehouse', 'Office', 'Other',
        'Other - Education', 'Other - Entertainment/Public Assembly', 'Other - Lodging/Residential',
        'Other - Public Service', 'Other - Recreation', 'Other - Restaurant/Bar',
        'Other - Retail/Mall', 'Other - Services', 'Other - Technology/Science',
        'Other - Utility', 'Performing Arts', 'Pre-school/Daycare', 'Prison/Incarceration',
        'Refrigerated Warehouse', 'Restaurant', 'Retail Store', 'Self-Storage Facility',
        'Social/Meeting Hall', 'Strip Mall', 'Supermarket/Grocery Store',
        'Urgent Care/Clinic/Other Outpatient', 'Vehicle Dealership', 'Vehicle Repair Services',
        'Wholesale Club/Supercenter', 'Worship Facility'
    }
    
    print("Building Type Verification Analysis")
    print("="*50)
    
    # Analyze category file
    print(f"\n=== Category File Analysis ===")
    actual_building_types = set()
    
    with open(category_file, 'r', encoding='utf-8') as file:
        reader = csv.DictReader(file)
        for row in reader:
            building_type = row.get('building_type', '').strip()
            if building_type:
                actual_building_types.add(building_type)
    
    print(f"Building types in enum: {len(building_types_enum)}")
    print(f"Building types in file: {len(actual_building_types)}")
    
    missing_from_enum = actual_building_types - building_types_enum
    missing_from_file = building_types_enum - actual_building_types
    
    if missing_from_enum:
        print(f"Building types in file but NOT in enum: {missing_from_enum}")
    else:
        print("✓ All building types from file are in enum")
        
    if missing_from_file:
        print(f"Building types in enum but NOT in file: {missing_from_file}")
    else:
        print("✓ All building types from enum are in file")
    
    # Analyze subcategory file
    print(f"\n=== Subcategory File Analysis ===")
    actual_building_subtypes = set()
    
    with open(subcategory_file, 'r', encoding='utf-8') as file:
        reader = csv.DictReader(file)
        for row in reader:
            building_subtype = row.get('building_subtype', '').strip()
            if building_subtype:
                actual_building_subtypes.add(building_subtype)
    
    print(f"Building subtypes in enum: {len(building_subtypes_enum)}")
    print(f"Building subtypes in file: {len(actual_building_subtypes)}")
    
    missing_from_enum = actual_building_subtypes - building_subtypes_enum
    missing_from_file = building_subtypes_enum - actual_building_subtypes
    
    if missing_from_enum:
        print(f"Building subtypes in file but NOT in enum:")
        for subtype in sorted(missing_from_enum):
            print(f"  '{subtype}'")
    else:
        print("✓ All building subtypes from file are in enum")
        
    if missing_from_file:
        print(f"Building subtypes in enum but NOT in file:")
        for subtype in sorted(missing_from_file):
            print(f"  '{subtype}'")
    else:
        print("✓ All building subtypes from enum are in file")

def find_common_missing_patterns():
    """Find the most common patterns in missing combinations."""
    
    # File is now in the same directory as this script
    category_file = os.path.join(os.path.dirname(__file__), 'energystar_site_eui_by_category.csv')
    
    print(f"\n=== Most Common Gaps Analysis ===")
    
    # Track combinations and which ones have EUI data
    combinations_with_eui = set()
    all_combinations = set()
    eui_by_building_type = defaultdict(int)
    total_by_building_type = defaultdict(int)
    
    with open(category_file, 'r', encoding='utf-8') as file:
        reader = csv.DictReader(file)
        for row in reader:
            building_type = row.get('building_type', '').strip()
            climate_zone = row.get('climate_zone', '').strip()
            year_built = row.get('year_built', '').strip()
            weekly_hours = row.get('weekly_hours', '').strip()
            gfa = row.get('gfa', '').strip()
            
            combination = (building_type, climate_zone, year_built, weekly_hours, gfa)
            all_combinations.add(combination)
            total_by_building_type[building_type] += 1
            
            twenty_fifth_percentile = row.get('twenty_fifth_percentile', '').strip()
            has_eui_data = twenty_fifth_percentile and twenty_fifth_percentile != ''
            
            if has_eui_data:
                combinations_with_eui.add(combination)
                eui_by_building_type[building_type] += 1
    
    # Calculate completeness by building type
    print("EUI Data Completeness by Building Type:")
    print(f"{'Building Type':<30} {'With EUI':<10} {'Total':<10} {'%':<10}")
    print("-" * 60)
    
    building_type_stats = []
    for building_type in sorted(total_by_building_type.keys()):
        total = total_by_building_type[building_type]
        with_eui = eui_by_building_type[building_type]
        percentage = (with_eui / total * 100) if total > 0 else 0
        building_type_stats.append((building_type, with_eui, total, percentage))
        print(f"{building_type:<30} {with_eui:<10} {total:<10} {percentage:<10.1f}")
    
    # Show building types with lowest completeness
    print(f"\nBuilding Types with Lowest EUI Completeness:")
    sorted_stats = sorted(building_type_stats, key=lambda x: x[3])
    for building_type, with_eui, total, percentage in sorted_stats[:5]:
        print(f"  {building_type}: {percentage:.1f}% ({with_eui}/{total})")

if __name__ == "__main__":
    analyze_building_types_in_files()
    find_common_missing_patterns()
