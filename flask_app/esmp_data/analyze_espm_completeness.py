#!/usr/bin/env python3
"""
Analyze ESPM data completeness by calculating what percentage of possible 
combinations actually have EUI data in the twenty_fifth_percentile field.
"""

import csv
import os
from itertools import product

def analyze_file_completeness(csv_file_path, building_field_name):
    """
    Analyze data completeness for an ESPM CSV file.
    
    Args:
        csv_file_path: Path to the CSV file
        building_field_name: Name of the building field ('building_type' or 'building_subtype')
    
    Returns:
        Dictionary with analysis results
    """
    
    # Define all possible values for each dimension
    building_types_category = {
        'All', 'Banking/financial services', 'Education', 'Entertainment/public assembly',
        'Food sales and service', 'Healthcare', 'Lodging/residential', 'Manufacturing/industrial',
        'Office', 'Other', 'Public services', 'Religious worship', 'Retail', 'Services',
        'Technology/science', 'Utility', 'Warehouse/storage'
    }
    
    building_subtypes = {
        'Personal Services (Health/Beauty, Dry Cleaning, etc.)', 'All', 'Bank Branch', 'College/University',
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
    
    climate_zones = {
        'All', '1A', '2A', '2B', '3A', '3B', '3C', '4A', '4B', '4C', 
        '5A', '5B', '6A', '6B', '7', '8'
    }
    
    year_built_ranges = {
        'All', 'Before 1946', '1946-1959', '1960-1979', '1980-1999', 
        '2000-2009', '2010 and after'
    }
    
    weekly_hours_ranges = {
        'All', 'Fewer than 40', '40-48', '48.01 - 60', '60.01 - 84', 
        '84.01-167', 'Open Continuously'
    }
    
    gfa_ranges = {
        'All', '1,000 - 4,999', '5,000 - 9,999', '10,000 - 24,999', 
        '25,000 - 49,999', '50,000 - 99,999', '100,000 - 199,999', 
        '200,000 - 499,999', '500,000 - 999,999', '1,000,000+'
    }
    
    # Select building types based on file
    building_types = building_types_category if building_field_name == 'building_type' else building_subtypes
    
    # Calculate total possible combinations
    total_possible = (len(building_types) * len(climate_zones) * len(year_built_ranges) * 
                     len(weekly_hours_ranges) * len(gfa_ranges))
    
    print(f"\n=== Analyzing {os.path.basename(csv_file_path)} ===")
    print(f"Building field: {building_field_name}")
    print(f"Building types: {len(building_types)}")
    print(f"Climate zones: {len(climate_zones)}")
    print(f"Year built ranges: {len(year_built_ranges)}")
    print(f"Weekly hours ranges: {len(weekly_hours_ranges)}")
    print(f"GFA ranges: {len(gfa_ranges)}")
    print(f"Total possible combinations: {total_possible:,}")
    
    # Read the CSV file and analyze actual data
    actual_combinations = set()
    combinations_with_eui = set()
    total_rows = 0
    rows_with_eui = 0
    
    if not os.path.exists(csv_file_path):
        print(f"Error: File not found: {csv_file_path}")
        return None
    
    with open(csv_file_path, 'r', encoding='utf-8') as file:
        reader = csv.DictReader(file)
        
        for row in reader:
            total_rows += 1
            
            # Get the combination tuple
            building_type = row.get(building_field_name, '').strip()
            climate_zone = row.get('climate_zone', '').strip()
            year_built = row.get('year_built', '').strip()
            weekly_hours = row.get('weekly_hours', '').strip()
            gfa = row.get('gfa', '').strip()
            
            combination = (building_type, climate_zone, year_built, weekly_hours, gfa)
            actual_combinations.add(combination)
            
            # Check if this row has EUI data
            twenty_fifth_percentile = row.get('twenty_fifth_percentile', '').strip()
            has_eui_data = twenty_fifth_percentile and twenty_fifth_percentile != ''
            
            if has_eui_data:
                rows_with_eui += 1
                combinations_with_eui.add(combination)
    
    # Calculate statistics
    actual_combinations_count = len(actual_combinations)
    combinations_with_eui_count = len(combinations_with_eui)
    
    completeness_of_possible = (combinations_with_eui_count / total_possible) * 100
    completeness_of_actual = (combinations_with_eui_count / actual_combinations_count) * 100 if actual_combinations_count > 0 else 0
    coverage_of_possible = (actual_combinations_count / total_possible) * 100
    row_completeness = (rows_with_eui / total_rows) * 100 if total_rows > 0 else 0
    
    print(f"\n--- Results ---")
    print(f"Total rows in file: {total_rows:,}")
    print(f"Rows with EUI data: {rows_with_eui:,} ({row_completeness:.1f}%)")
    print(f"Unique combinations in file: {actual_combinations_count:,}")
    print(f"Combinations with EUI data: {combinations_with_eui_count:,}")
    print(f"Coverage of possible combinations: {coverage_of_possible:.1f}% ({actual_combinations_count:,}/{total_possible:,})")
    print(f"EUI completeness of possible combinations: {completeness_of_possible:.1f}% ({combinations_with_eui_count:,}/{total_possible:,})")
    print(f"EUI completeness of actual combinations: {completeness_of_actual:.1f}% ({combinations_with_eui_count:,}/{actual_combinations_count:,})")
    
    # Find some example missing combinations (for first few building types)
    missing_combinations = []
    building_types_list = sorted(building_types)[:3]  # Just check first 3 building types
    
    for bt in building_types_list:
        for cz in sorted(climate_zones)[:3]:  # Just check first 3 climate zones
            for yb in sorted(year_built_ranges)[:2]:  # Just check first 2 year ranges
                combination = (bt, cz, yb, 'All', 'All')
                if combination not in actual_combinations:
                    missing_combinations.append(combination)
                    if len(missing_combinations) >= 5:  # Limit examples
                        break
            if len(missing_combinations) >= 5:
                break
        if len(missing_combinations) >= 5:
            break
    
    if missing_combinations:
        print(f"\nExample missing combinations:")
        for combo in missing_combinations[:5]:
            print(f"  {combo}")
    
    return {
        'file': os.path.basename(csv_file_path),
        'building_field': building_field_name,
        'total_possible': total_possible,
        'actual_combinations': actual_combinations_count,
        'combinations_with_eui': combinations_with_eui_count,
        'total_rows': total_rows,
        'rows_with_eui': rows_with_eui,
        'coverage_percent': coverage_of_possible,
        'eui_completeness_of_possible_percent': completeness_of_possible,
        'eui_completeness_of_actual_percent': completeness_of_actual,
        'row_completeness_percent': row_completeness
    }

def main():
    """Main analysis function."""
    
    # Define file paths - now we're in the espm directory, so files are in current directory
    category_file = os.path.join(os.path.dirname(__file__), 'energystar_site_eui_by_category.csv')
    subcategory_file = os.path.join(os.path.dirname(__file__), 'energystar_site_eui_by_subcategory.csv')
    
    print("ESPM Data Completeness Analysis")
    print("="*50)
    
    # Analyze both files
    results = []
    
    # Category file analysis
    result1 = analyze_file_completeness(category_file, 'building_type')
    if result1:
        results.append(result1)
    
    # Subcategory file analysis  
    result2 = analyze_file_completeness(subcategory_file, 'building_subtype')
    if result2:
        results.append(result2)
    
    # Summary comparison
    if len(results) == 2:
        print(f"\n{'='*50}")
        print("SUMMARY COMPARISON")
        print(f"{'='*50}")
        print(f"{'Metric':<40} {'Category':<15} {'Subcategory':<15}")
        print(f"{'-'*70}")
        print(f"{'Total possible combinations':<40} {results[0]['total_possible']:,<14} {results[1]['total_possible']:,<14}")
        print(f"{'Actual combinations in file':<40} {results[0]['actual_combinations']:,<14} {results[1]['actual_combinations']:,<14}")
        print(f"{'Combinations with EUI data':<40} {results[0]['combinations_with_eui']:,<14} {results[1]['combinations_with_eui']:,<14}")
        print(f"{'Coverage of possible (%)':<40} {results[0]['coverage_percent']:<14.1f} {results[1]['coverage_percent']:<14.1f}")
        print(f"{'EUI completeness of possible (%)':<40} {results[0]['eui_completeness_of_possible_percent']:<14.1f} {results[1]['eui_completeness_of_possible_percent']:<14.1f}")
        print(f"{'EUI completeness of actual (%)':<40} {results[0]['eui_completeness_of_actual_percent']:<14.1f} {results[1]['eui_completeness_of_actual_percent']:<14.1f}")
        print(f"{'Row completeness (%)':<40} {results[0]['row_completeness_percent']:<14.1f} {results[1]['row_completeness_percent']:<14.1f}")

if __name__ == "__main__":
    main()
